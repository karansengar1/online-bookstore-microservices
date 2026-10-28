import { afterAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createCatalogClient, type CatalogClient } from "../src/catalog-client.js";
import { openDb } from "../src/db.js";

const BOOKS: Record<string, { title: string; author: string; priceCents: number; stock: number }> = {
  clean: { title: "Clean Code", author: "Robert C. Martin", priceCents: 4000, stock: 5 },
  refactoring: { title: "Refactoring", author: "Martin Fowler", priceCents: 2500, stock: 3 },
};

/** A stand-in for the Catalog service, so these tests need no network. */
function fakeCatalog(state: { down: boolean }): CatalogClient {
  return {
    async getBook(bookId) {
      if (state.down) return { status: "unavailable" };
      const book = BOOKS[bookId];
      if (!book) return { status: "not_found" };
      return { status: "ok", book: { id: bookId, ...book } };
    },
  };
}

const ANNA = { "x-user-id": "anna" };
const BEN = { "x-user-id": "ben" };

describe("cart-service", () => {
  let app: ReturnType<typeof createApp>;
  let catalogState: { down: boolean };

  beforeEach(() => {
    catalogState = { down: false };
    app = createApp(openDb(":memory:"), fakeCatalog(catalogState));
  });

  const add = (headers: Record<string, string>, bookId: string, quantity: number) =>
    request(app).post("/api/cart/items").set(headers).send({ bookId, quantity });

  it("answers 401 without the identity header", async () => {
    expect((await request(app).get("/api/cart")).status).toBe(401);
    expect((await request(app).post("/api/cart/items").send({ bookId: "clean", quantity: 1 })).status).toBe(401);
  });

  it("starts with an empty cart", async () => {
    const res = await request(app).get("/api/cart").set(ANNA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], totalCents: 0, catalogAvailable: true });
  });

  it("adds a book and shows title, price and total", async () => {
    expect((await add(ANNA, "clean", 2)).status).toBe(201);
    await add(ANNA, "refactoring", 1);
    const res = await request(app).get("/api/cart").set(ANNA);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ bookId: "clean", quantity: 2, lineTotalCents: 8000, book: { title: "Clean Code" } });
    expect(res.body.totalCents).toBe(10500);
  });

  it("adds up the quantity when the same book is added again", async () => {
    await add(ANNA, "clean", 2);
    const res = await add(ANNA, "clean", 1);
    expect(res.body.quantity).toBe(3);
  });

  it("answers 404 for a book that does not exist", async () => {
    expect((await add(ANNA, "unknown", 1)).status).toBe(404);
  });

  it("answers 409 when more is requested than is in stock", async () => {
    const res = await add(ANNA, "refactoring", 4);
    expect(res.status).toBe(409);
    expect(res.body.available).toBe(3);
    await add(ANNA, "refactoring", 2);
    expect((await add(ANNA, "refactoring", 2)).status).toBe(409);
  });

  it("rejects a quantity of 0 with 400", async () => {
    expect((await add(ANNA, "clean", 0)).status).toBe(400);
  });

  it("answers 503 when adding while the Catalog service is down", async () => {
    catalogState.down = true;
    expect((await add(ANNA, "clean", 1)).status).toBe(503);
  });

  it("still shows the cart when the Catalog service is down, without details", async () => {
    await add(ANNA, "clean", 2);
    catalogState.down = true;
    const res = await request(app).get("/api/cart").set(ANNA);
    expect(res.status).toBe(200);
    expect(res.body.catalogAvailable).toBe(false);
    expect(res.body.totalCents).toBeNull();
    expect(res.body.items[0]).toMatchObject({ bookId: "clean", quantity: 2, book: null });
  });

  it("changes a quantity, and checks stock and membership", async () => {
    await add(ANNA, "clean", 1);
    const ok = await request(app).patch("/api/cart/items/clean").set(ANNA).send({ quantity: 4 });
    expect(ok.status).toBe(200);
    expect(ok.body.quantity).toBe(4);
    expect((await request(app).patch("/api/cart/items/clean").set(ANNA).send({ quantity: 9 })).status).toBe(409);
    expect((await request(app).patch("/api/cart/items/refactoring").set(ANNA).send({ quantity: 1 })).status).toBe(404);
  });

  it("removes one item, then answers 404 for it", async () => {
    await add(ANNA, "clean", 1);
    expect((await request(app).delete("/api/cart/items/clean").set(ANNA)).status).toBe(204);
    expect((await request(app).delete("/api/cart/items/clean").set(ANNA)).status).toBe(404);
  });

  it("empties the whole cart", async () => {
    await add(ANNA, "clean", 1);
    await add(ANNA, "refactoring", 1);
    expect((await request(app).delete("/api/cart").set(ANNA)).status).toBe(204);
    const res = await request(app).get("/api/cart").set(ANNA);
    expect(res.body.items).toEqual([]);
  });

  it("keeps carts of different users apart", async () => {
    await add(ANNA, "clean", 2);
    await add(BEN, "refactoring", 1);
    const anna = await request(app).get("/api/cart").set(ANNA);
    const ben = await request(app).get("/api/cart").set(BEN);
    expect(anna.body.items.map((i: { bookId: string }) => i.bookId)).toEqual(["clean"]);
    expect(ben.body.items.map((i: { bookId: string }) => i.bookId)).toEqual(["refactoring"]);
  });

  it("gives the raw cart lines to other services on the internal endpoint", async () => {
    await add(ANNA, "clean", 2);
    const res = await request(app).get("/internal/carts/anna");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "anna", items: [{ bookId: "clean", quantity: 2 }] });
    expect((await request(app).get("/internal/carts/nobody")).body.items).toEqual([]);
  });
});

describe("catalog client", () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/internal/books/b1") {
      res.end(JSON.stringify({ id: "b1", title: "T", author: "A", priceCents: 100, stock: 3 }));
    } else if (req.url === "/internal/books/broken") {
      res.statusCode = 500;
      res.end("{}");
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  let baseUrl = "";

  beforeEach(async () => {
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });
  afterAll(() => {
    server.close();
  });

  it("returns the book, not_found, or unavailable", async () => {
    const client = createCatalogClient(baseUrl);
    expect(await client.getBook("b1")).toMatchObject({ status: "ok", book: { id: "b1", stock: 3 } });
    expect(await client.getBook("missing")).toEqual({ status: "not_found" });
    expect(await client.getBook("broken")).toEqual({ status: "unavailable" });
  });

  it("reports unavailable when nothing is listening", async () => {
    const client = createCatalogClient("http://127.0.0.1:1", 500);
    expect(await client.getBook("b1")).toEqual({ status: "unavailable" });
  });
});
