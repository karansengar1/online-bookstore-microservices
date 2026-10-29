import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { CartClient, CatalogClient, Line } from "../src/clients.js";
import { openDb, type Db } from "../src/db.js";

/** Fake Cart service: each user's cart is just an array in memory. */
function fakeCart(carts: Record<string, Line[]>, state: { down: boolean }): CartClient {
  return {
    async getCart(userId) {
      if (state.down) return { status: "unavailable" };
      return { status: "ok", items: carts[userId] ?? [] };
    },
  };
}

/** Fake Catalog service: all-or-nothing reservation on an in-memory stock list. */
function fakeCatalog(stock: Record<string, { title: string; priceCents: number; stock: number }>, state: { down: boolean }) {
  const released: Line[][] = [];
  const client: CatalogClient = {
    async reserve(items) {
      if (state.down) return { status: "unavailable" };
      for (const item of items) {
        const book = stock[item.bookId];
        if (!book) return { status: "not_found", bookId: item.bookId };
        if (book.stock < item.quantity) return { status: "insufficient_stock", bookId: item.bookId };
      }
      for (const item of items) stock[item.bookId]!.stock -= item.quantity;
      return {
        status: "ok",
        items: items.map((i) => ({ ...i, title: stock[i.bookId]!.title, priceCents: stock[i.bookId]!.priceCents })),
      };
    },
    async release(items) {
      released.push(items);
    },
  };
  return { client, released };
}

const ANNA = { "x-user-id": "anna", "x-user-role": "CUSTOMER" };
const BEN = { "x-user-id": "ben", "x-user-role": "CUSTOMER" };
const ADMIN = { "x-user-id": "admin", "x-user-role": "ADMIN" };

describe("order-service", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let carts: Record<string, Line[]>;
  let stock: Record<string, { title: string; priceCents: number; stock: number }>;
  let down: { cart: { down: boolean }; catalog: { down: boolean } };
  let released: Line[][];

  const events = () =>
    (db.prepare("SELECT routing_key, payload FROM outbox ORDER BY rowid").all() as { routing_key: string; payload: string }[]).map((r) => ({
      key: r.routing_key,
      envelope: JSON.parse(r.payload) as { eventId: string; type: string; data: Record<string, unknown> },
    }));

  const placeOrder = (headers = ANNA) => request(app).post("/api/orders").set(headers);

  beforeEach(() => {
    db = openDb(":memory:");
    carts = { anna: [{ bookId: "clean", quantity: 2 }, { bookId: "refactoring", quantity: 1 }] };
    stock = {
      clean: { title: "Clean Code", priceCents: 4000, stock: 5 },
      refactoring: { title: "Refactoring", priceCents: 2500, stock: 3 },
    };
    down = { cart: { down: false }, catalog: { down: false } };
    const catalog = fakeCatalog(stock, down.catalog);
    released = catalog.released;
    app = createApp(db, { cart: fakeCart(carts, down.cart), catalog: catalog.client });
  });

  describe("placing an order", () => {
    it("answers 401 without the identity header", async () => {
      expect((await request(app).post("/api/orders")).status).toBe(401);
    });

    it("creates an order from the cart with a price snapshot and the right total", async () => {
      const res = await placeOrder();
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ userId: "anna", status: "PLACED", totalCents: 10500 });
      expect(res.body.items).toEqual([
        { bookId: "clean", title: "Clean Code", unitPriceCents: 4000, quantity: 2 },
        { bookId: "refactoring", title: "Refactoring", unitPriceCents: 2500, quantity: 1 },
      ]);
      expect(stock.clean!.stock).toBe(3);
    });

    it("saves an order.placed event in the outbox together with the order", async () => {
      const res = await placeOrder();
      const [event] = events();
      expect(event!.key).toBe("order.placed");
      expect(event!.envelope.type).toBe("order.placed");
      expect(event!.envelope.eventId).toBeTruthy();
      expect(event!.envelope.data).toMatchObject({
        orderId: res.body.id,
        userId: "anna",
        totalCents: 10500,
        items: [{ bookId: "clean", quantity: 2 }, { bookId: "refactoring", quantity: 1 }],
      });
    });

    it("answers 400 for an empty cart", async () => {
      const res = await placeOrder(BEN);
      expect(res.status).toBe(400);
    });

    it("answers 409 when there is not enough stock and creates nothing", async () => {
      stock.clean!.stock = 1;
      const res = await placeOrder();
      expect(res.status).toBe(409);
      expect(res.body.bookId).toBe("clean");
      expect((await request(app).get("/api/orders").set(ANNA)).body).toEqual([]);
      expect(events()).toHaveLength(0);
      expect(stock.refactoring!.stock).toBe(3); // nothing was taken
    });

    it("answers 409 when a book no longer exists", async () => {
      delete stock.clean;
      expect((await placeOrder()).status).toBe(409);
    });

    it("answers 503 when the Cart service is down", async () => {
      down.cart.down = true;
      expect((await placeOrder()).status).toBe(503);
    });

    it("answers 503 when the Catalog service is down and creates nothing", async () => {
      down.catalog.down = true;
      expect((await placeOrder()).status).toBe(503);
      expect(events()).toHaveLength(0);
    });

    it("gives the reserved stock back if saving the order fails", async () => {
      db.exec("DROP TABLE outbox"); // makes the save fail after the stock was reserved
      const res = await placeOrder();
      expect(res.status).toBe(500);
      expect(released).toEqual([carts.anna]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
    });
  });

  describe("reading orders", () => {
    it("shows customers only their own orders and admins all of them", async () => {
      carts.ben = [{ bookId: "refactoring", quantity: 1 }];
      await placeOrder(ANNA);
      await placeOrder(BEN);
      const anna = await request(app).get("/api/orders").set(ANNA);
      const admin = await request(app).get("/api/orders").set(ADMIN);
      expect(anna.body).toHaveLength(1);
      expect(anna.body[0].userId).toBe("anna");
      expect(admin.body).toHaveLength(2);
    });

    it("shows one order to its owner and to admins, and hides it from others", async () => {
      const id = (await placeOrder()).body.id;
      expect((await request(app).get(`/api/orders/${id}`).set(ANNA)).status).toBe(200);
      expect((await request(app).get(`/api/orders/${id}`).set(ADMIN)).status).toBe(200);
      expect((await request(app).get(`/api/orders/${id}`).set(BEN)).status).toBe(404);
      expect((await request(app).get("/api/orders/nope").set(ANNA)).status).toBe(404);
    });
  });

  describe("cancelling", () => {
    it("lets the owner cancel a PLACED order and records order.cancelled with the items", async () => {
      const id = (await placeOrder()).body.id;
      const res = await request(app).post(`/api/orders/${id}/cancel`).set(ANNA);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CANCELLED");
      const cancelled = events().find((e) => e.key === "order.cancelled");
      expect(cancelled!.envelope.data).toMatchObject({
        orderId: id,
        items: [{ bookId: "clean", quantity: 2 }, { bookId: "refactoring", quantity: 1 }],
      });
    });

    it("lets an admin cancel, but not another customer", async () => {
      const id = (await placeOrder()).body.id;
      expect((await request(app).post(`/api/orders/${id}/cancel`).set(BEN)).status).toBe(404);
      expect((await request(app).post(`/api/orders/${id}/cancel`).set(ADMIN)).status).toBe(200);
    });

    it("answers 409 when cancelling twice or after shipping", async () => {
      const id = (await placeOrder()).body.id;
      await request(app).post(`/api/orders/${id}/cancel`).set(ANNA);
      expect((await request(app).post(`/api/orders/${id}/cancel`).set(ANNA)).status).toBe(409);

      carts.anna = [{ bookId: "clean", quantity: 1 }];
      const second = (await placeOrder()).body.id;
      await request(app).patch(`/api/orders/${second}/status`).set(ADMIN).send({ status: "SHIPPED" });
      expect((await request(app).post(`/api/orders/${second}/cancel`).set(ANNA)).status).toBe(409);
    });
  });

  describe("status changes (admin)", () => {
    it("moves an order PLACED -> SHIPPED -> DELIVERED and records an event each time", async () => {
      const id = (await placeOrder()).body.id;
      const shipped = await request(app).patch(`/api/orders/${id}/status`).set(ADMIN).send({ status: "SHIPPED" });
      expect(shipped.body.status).toBe("SHIPPED");
      const delivered = await request(app).patch(`/api/orders/${id}/status`).set(ADMIN).send({ status: "DELIVERED" });
      expect(delivered.body.status).toBe("DELIVERED");
      expect(events().map((e) => e.key)).toEqual(["order.placed", "order.shipped", "order.delivered"]);
    });

    it("forbids customers", async () => {
      const id = (await placeOrder()).body.id;
      const res = await request(app).patch(`/api/orders/${id}/status`).set(ANNA).send({ status: "SHIPPED" });
      expect(res.status).toBe(403);
    });

    it("rejects skipping a step with 409 and unknown values with 400", async () => {
      const id = (await placeOrder()).body.id;
      expect((await request(app).patch(`/api/orders/${id}/status`).set(ADMIN).send({ status: "DELIVERED" })).status).toBe(409);
      expect((await request(app).patch(`/api/orders/${id}/status`).set(ADMIN).send({ status: "CANCELLED" })).status).toBe(400);
      expect((await request(app).patch("/api/orders/nope/status").set(ADMIN).send({ status: "SHIPPED" })).status).toBe(404);
    });
  });
});
