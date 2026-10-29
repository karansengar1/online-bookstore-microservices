import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CartClient, CatalogClient } from "./clients.js";
import type { Db, OrderItemRow, OrderRow, OrderStatus } from "./db.js";
import { enqueueEvent } from "./outbox.js";

export interface Deps {
  cart: CartClient;
  catalog: CatalogClient;
}

const statusSchema = z.object({ status: z.enum(["SHIPPED", "DELIVERED"]) });

/** The only allowed steps in the order lifecycle (see the state diagram in the docs). */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = { PLACED: "SHIPPED", SHIPPED: "DELIVERED" };

export function createApp(db: Db, deps: Deps) {
  const app = express();
  app.use(express.json());

  const getOrder = db.prepare("SELECT * FROM orders WHERE id = ?");
  const getItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid");

  function present(order: OrderRow) {
    const items = getItems.all(order.id) as OrderItemRow[];
    return {
      id: order.id,
      userId: order.user_id,
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: items.map((i) => ({
        bookId: i.book_id,
        title: i.title_snapshot,
        unitPriceCents: i.unit_price_cents,
        quantity: i.quantity,
      })),
    };
  }

  function currentUser(req: Request, res: Response): { id: string; isAdmin: boolean } | undefined {
    const id = req.header("x-user-id");
    if (!id) {
      res.status(401).json({ error: "Not authenticated" });
      return undefined;
    }
    return { id, isAdmin: req.header("x-user-role") === "ADMIN" };
  }

  /** The order and its items are saved together with the event, or not at all. */
  const saveNewOrder = db.transaction(
    (order: OrderRow, items: { bookId: string; title: string; unitPriceCents: number; quantity: number }[]) => {
      db.prepare("INSERT INTO orders (id, user_id, status, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        order.id, order.user_id, order.status, order.total_cents, order.created_at, order.updated_at,
      );
      const insertItem = db.prepare(
        "INSERT INTO order_items (id, order_id, book_id, title_snapshot, unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const item of items) {
        insertItem.run(randomUUID(), order.id, item.bookId, item.title, item.unitPriceCents, item.quantity);
      }
      enqueueEvent(db, "order.placed", {
        orderId: order.id,
        userId: order.user_id,
        totalCents: order.total_cents,
        items: items.map((i) => ({ bookId: i.bookId, quantity: i.quantity })),
      });
    },
  );

  /** Changes the status and records the matching event in one step. */
  const changeStatus = db.transaction((order: OrderRow, status: OrderStatus, eventType: string, eventData: unknown) => {
    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), order.id);
    enqueueEvent(db, eventType, eventData);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "order-service" });
  });

  // POST /api/orders  -> turns the caller's cart into an order
  app.post("/api/orders", async (req, res) => {
    const user = currentUser(req, res);
    if (!user) return;

    const cart = await deps.cart.getCart(user.id);
    if (cart.status === "unavailable") {
      res.status(503).json({ error: "Cart service unavailable" });
      return;
    }
    if (cart.items.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }

    // Step 1: reserve the stock (all-or-nothing). This is the answer the customer waits for.
    const reservation = await deps.catalog.reserve(cart.items);
    if (reservation.status === "unavailable") {
      res.status(503).json({ error: "Catalog service unavailable" });
      return;
    }
    if (reservation.status === "insufficient_stock") {
      res.status(409).json({ error: "Not enough stock", bookId: reservation.bookId });
      return;
    }
    if (reservation.status === "not_found") {
      res.status(409).json({ error: "Book no longer available", bookId: reservation.bookId });
      return;
    }

    // Step 2: save the order. If that fails, give the reserved stock back (compensation).
    const now = new Date().toISOString();
    const order: OrderRow = {
      id: randomUUID(),
      user_id: user.id,
      status: "PLACED",
      total_cents: reservation.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0),
      created_at: now,
      updated_at: now,
    };
    try {
      saveNewOrder(
        order,
        reservation.items.map((i) => ({ bookId: i.bookId, title: i.title, unitPriceCents: i.priceCents, quantity: i.quantity })),
      );
    } catch (err) {
      console.error("Saving the order failed, releasing the stock:", err);
      await deps.catalog.release(cart.items);
      res.status(500).json({ error: "Could not save the order" });
      return;
    }

    res.status(201).json(present(order));
  });

  // GET /api/orders  -> own orders, or all orders for an admin
  app.get("/api/orders", (req, res) => {
    const user = currentUser(req, res);
    if (!user) return;
    const rows = (
      user.isAdmin
        ? db.prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 200").all()
        : db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200").all(user.id)
    ) as OrderRow[];
    res.json(rows.map(present));
  });

  // GET /api/orders/:id  -> owner or admin. Everyone else gets 404, so they cannot learn that the order exists.
  app.get("/api/orders/:id", (req, res) => {
    const user = currentUser(req, res);
    if (!user) return;
    const order = getOrder.get(String(req.params.id)) as OrderRow | undefined;
    if (!order || (!user.isAdmin && order.user_id !== user.id)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(present(order));
  });

  // POST /api/orders/:id/cancel  -> only while PLACED. The Catalog service gives the stock back when it hears the event.
  app.post("/api/orders/:id/cancel", (req, res) => {
    const user = currentUser(req, res);
    if (!user) return;
    const order = getOrder.get(String(req.params.id)) as OrderRow | undefined;
    if (!order || (!user.isAdmin && order.user_id !== user.id)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.status !== "PLACED") {
      res.status(409).json({ error: `An order that is ${order.status} cannot be cancelled` });
      return;
    }
    const items = (getItems.all(order.id) as OrderItemRow[]).map((i) => ({ bookId: i.book_id, quantity: i.quantity }));
    changeStatus(order, "CANCELLED", "order.cancelled", { orderId: order.id, userId: order.user_id, items });
    res.json(present(getOrder.get(order.id) as OrderRow));
  });

  // PATCH /api/orders/:id/status  { status: "SHIPPED" | "DELIVERED" }   (admin)
  app.patch("/api/orders/:id/status", (req, res) => {
    const user = currentUser(req, res);
    if (!user) return;
    if (!user.isAdmin) {
      res.status(403).json({ error: "Admins only" });
      return;
    }
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Status must be SHIPPED or DELIVERED" });
      return;
    }
    const order = getOrder.get(String(req.params.id)) as OrderRow | undefined;
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const { status } = parsed.data;
    if (NEXT_STATUS[order.status] !== status) {
      res.status(409).json({ error: `An order that is ${order.status} cannot become ${status}` });
      return;
    }
    changeStatus(order, status, `order.${status.toLowerCase()}`, { orderId: order.id, userId: order.user_id });
    res.json(present(getOrder.get(order.id) as OrderRow));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number } | null)?.status;
    if (err instanceof SyntaxError || status === 400) {
      res.status(400).json({ error: "Malformed JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
