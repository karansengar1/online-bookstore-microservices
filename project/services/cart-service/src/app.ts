import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { CatalogClient } from "./catalog-client.js";
import type { Db } from "./db.js";
import { createRepo } from "./repo.js";

const addItemSchema = z.object({
  bookId: z.string().min(1),
  quantity: z.number().int().min(1).max(100),
});

const changeQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(100),
});

export function createApp(db: Db, catalog: CatalogClient) {
  const repo = createRepo(db);
  const app = express();
  app.use(express.json());

  /** The gateway sets X-User-Id after checking the JWT. Without it the caller is not logged in. */
  function currentUser(req: Request, res: Response): string | undefined {
    const userId = req.header("x-user-id");
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return undefined;
    }
    return userId;
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "cart-service" });
  });

  // GET /api/cart  -> the cart with title and price of each book (asked from the Catalog service)
  app.get("/api/cart", async (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;

    const items = repo.getItems(userId);
    const lookups = await Promise.all(items.map((item) => catalog.getBook(item.bookId)));

    let catalogAvailable = true;
    let totalCents = 0;
    const detailed = items.map((item, i) => {
      const lookup = lookups[i]!;
      if (lookup.status === "ok") {
        const lineTotalCents = lookup.book.priceCents * item.quantity;
        totalCents += lineTotalCents;
        const { title, author, priceCents, stock } = lookup.book;
        return { bookId: item.bookId, quantity: item.quantity, book: { title, author, priceCents, stock }, lineTotalCents };
      }
      // The cart still works when the Catalog service is down: we just cannot show details.
      if (lookup.status === "unavailable") catalogAvailable = false;
      return { bookId: item.bookId, quantity: item.quantity, book: null, lineTotalCents: null };
    });

    res.json({ items: detailed, totalCents: catalogAvailable ? totalCents : null, catalogAvailable });
  });

  // POST /api/cart/items  { bookId, quantity }  -> adds to the quantity already in the cart
  app.post("/api/cart/items", async (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;
    const parsed = addItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { bookId, quantity } = parsed.data;

    const lookup = await catalog.getBook(bookId);
    if (lookup.status === "not_found") {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (lookup.status === "unavailable") {
      res.status(503).json({ error: "Catalog service unavailable" });
      return;
    }

    const newQuantity = repo.getQuantity(userId, bookId) + quantity;
    if (newQuantity > lookup.book.stock) {
      res.status(409).json({ error: "Not enough stock", available: lookup.book.stock });
      return;
    }
    repo.setQuantity(userId, bookId, newQuantity);
    res.status(201).json({ bookId, quantity: newQuantity });
  });

  // PATCH /api/cart/items/:bookId  { quantity }  -> sets the quantity
  app.patch("/api/cart/items/:bookId", async (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;
    const bookId = String(req.params.bookId);
    const parsed = changeQuantitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    if (repo.getQuantity(userId, bookId) === 0) {
      res.status(404).json({ error: "Item not in cart" });
      return;
    }

    const lookup = await catalog.getBook(bookId);
    if (lookup.status === "not_found") {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (lookup.status === "unavailable") {
      res.status(503).json({ error: "Catalog service unavailable" });
      return;
    }
    if (parsed.data.quantity > lookup.book.stock) {
      res.status(409).json({ error: "Not enough stock", available: lookup.book.stock });
      return;
    }
    repo.setQuantity(userId, bookId, parsed.data.quantity);
    res.json({ bookId, quantity: parsed.data.quantity });
  });

  // DELETE /api/cart/items/:bookId
  app.delete("/api/cart/items/:bookId", (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;
    if (!repo.removeItem(userId, String(req.params.bookId))) {
      res.status(404).json({ error: "Item not in cart" });
      return;
    }
    res.status(204).end();
  });

  // DELETE /api/cart  -> empties the cart
  app.delete("/api/cart", (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;
    repo.clear(userId);
    res.status(204).end();
  });

  // ---- Internal endpoint: used by the Order service, never reachable through the gateway ----

  // GET /internal/carts/:userId  -> raw cart lines (ids and quantities only)
  app.get("/internal/carts/:userId", (req, res) => {
    const userId = String(req.params.userId);
    res.json({ userId, items: repo.getItems(userId) });
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
