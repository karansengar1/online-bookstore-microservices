import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { seedBooks } from "../src/seed.js";

type TestApp = ReturnType<typeof createApp>;

const ADMIN = { "x-user-role": "ADMIN" };
let isbnCounter = 0;

function bookData(overrides: Record<string, unknown> = {}) {
  isbnCounter += 1;
  return { title: "Test Book", author: "Some Author", isbn: `TEST-${isbnCounter}`, priceCents: 1000, stock: 5, ...overrides };
}

async function addBook(app: TestApp, overrides: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/books").set(ADMIN).send(bookData(overrides));
  expect(res.status).toBe(201);
  return res.body as { id: string; title: string; stock: number; priceCents: number };
}

describe("catalog-service", () => {
  let app: TestApp;
  beforeEach(() => {
    app = createApp(openDb(":memory:"));
  });

  describe("reading books", () => {
    it("lists books with paging info", async () => {
      await addBook(app, { title: "Alpha" });
      await addBook(app, { title: "Beta" });
      await addBook(app, { title: "Gamma" });
      const res = await request(app).get("/api/books?page=1&pageSize=2");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items.map((b: { title: string }) => b.title)).toEqual(["Alpha", "Beta"]);
      const page2 = await request(app).get("/api/books?page=2&pageSize=2");
      expect(page2.body.items).toHaveLength(1);
    });

    it("searches by title or author, ignoring case", async () => {
      await addBook(app, { title: "Clean Code", author: "Robert Martin" });
      await addBook(app, { title: "Refactoring", author: "Martin Fowler" });
      await addBook(app, { title: "Other", author: "Nobody" });
      const res = await request(app).get("/api/books?q=martin");
      expect(res.body.total).toBe(2);
      const byTitle = await request(app).get("/api/books?q=CLEAN");
      expect(byTitle.body.total).toBe(1);
    });

    it("treats % in a search literally", async () => {
      await addBook(app, { title: "100% Pure" });
      await addBook(app, { title: "Something else" });
      const res = await request(app).get("/api/books").query({ q: "%" });
      expect(res.body.total).toBe(1);
    });

    it("rejects an invalid page size", async () => {
      const res = await request(app).get("/api/books?pageSize=1000");
      expect(res.status).toBe(400);
    });

    it("returns one book, or 404", async () => {
      const book = await addBook(app);
      expect((await request(app).get(`/api/books/${book.id}`)).status).toBe(200);
      expect((await request(app).get("/api/books/does-not-exist")).status).toBe(404);
    });

    it("seeds demo books into an empty catalogue only once", async () => {
      const db = openDb(":memory:");
      seedBooks(db);
      seedBooks(db);
      const res = await request(createApp(db)).get("/api/books");
      expect(res.body.total).toBe(8);
    });
  });

  describe("managing books (admin only)", () => {
    it("lets an admin create, update and delete a book", async () => {
      const book = await addBook(app, { title: "Old title" });
      const updated = await request(app)
        .put(`/api/books/${book.id}`)
        .set(ADMIN)
        .send(bookData({ title: "New title", stock: 42 }));
      expect(updated.status).toBe(200);
      expect(updated.body.title).toBe("New title");
      expect(updated.body.stock).toBe(42);
      expect((await request(app).delete(`/api/books/${book.id}`).set(ADMIN)).status).toBe(204);
      expect((await request(app).get(`/api/books/${book.id}`)).status).toBe(404);
    });

    it("forbids customers and anonymous callers", async () => {
      const asCustomer = await request(app).post("/api/books").set("x-user-role", "CUSTOMER").send(bookData());
      const anonymous = await request(app).post("/api/books").send(bookData());
      expect(asCustomer.status).toBe(403);
      expect(anonymous.status).toBe(403);
    });

    it("rejects invalid data with 400", async () => {
      const res = await request(app).post("/api/books").set(ADMIN).send(bookData({ priceCents: -5, title: "" }));
      expect(res.status).toBe(400);
    });

    it("rejects a duplicate ISBN with 409", async () => {
      await request(app).post("/api/books").set(ADMIN).send(bookData({ isbn: "SAME-1" }));
      const res = await request(app).post("/api/books").set(ADMIN).send(bookData({ isbn: "SAME-1" }));
      expect(res.status).toBe(409);
    });

    it("answers 404 when updating or deleting an unknown book", async () => {
      expect((await request(app).put("/api/books/nope").set(ADMIN).send(bookData())).status).toBe(404);
      expect((await request(app).delete("/api/books/nope").set(ADMIN)).status).toBe(404);
    });
  });

  describe("stock reservation (internal)", () => {
    const stockOf = async (id: string) => (await request(app).get(`/api/books/${id}`)).body.stock as number;

    it("reserves stock and returns title and price for the order", async () => {
      const book = await addBook(app, { title: "Reserved", priceCents: 2500, stock: 5 });
      const res = await request(app).post("/internal/books/reserve").send({ items: [{ bookId: book.id, quantity: 3 }] });
      expect(res.status).toBe(200);
      expect(res.body.items[0]).toMatchObject({ bookId: book.id, title: "Reserved", priceCents: 2500, quantity: 3 });
      expect(await stockOf(book.id)).toBe(2);
    });

    it("answers 409 when there is not enough stock and changes nothing", async () => {
      const book = await addBook(app, { stock: 2 });
      const res = await request(app).post("/internal/books/reserve").send({ items: [{ bookId: book.id, quantity: 3 }] });
      expect(res.status).toBe(409);
      expect(res.body.bookId).toBe(book.id);
      expect(await stockOf(book.id)).toBe(2);
    });

    it("is all-or-nothing across several books", async () => {
      const a = await addBook(app, { stock: 5 });
      const b = await addBook(app, { stock: 1 });
      const res = await request(app)
        .post("/internal/books/reserve")
        .send({ items: [{ bookId: a.id, quantity: 2 }, { bookId: b.id, quantity: 2 }] });
      expect(res.status).toBe(409);
      expect(await stockOf(a.id)).toBe(5);
      expect(await stockOf(b.id)).toBe(1);
    });

    it("adds up the same book listed twice", async () => {
      const book = await addBook(app, { stock: 3 });
      const res = await request(app)
        .post("/internal/books/reserve")
        .send({ items: [{ bookId: book.id, quantity: 2 }, { bookId: book.id, quantity: 2 }] });
      expect(res.status).toBe(409);
      expect(await stockOf(book.id)).toBe(3);
    });

    it("answers 404 for an unknown book", async () => {
      const res = await request(app).post("/internal/books/reserve").send({ items: [{ bookId: "nope", quantity: 1 }] });
      expect(res.status).toBe(404);
    });

    it("rejects an empty or invalid request with 400", async () => {
      expect((await request(app).post("/internal/books/reserve").send({ items: [] })).status).toBe(400);
      expect((await request(app).post("/internal/books/reserve").send({ items: [{ bookId: "x", quantity: 0 }] })).status).toBe(400);
    });

    it("gives the stock back on release", async () => {
      const book = await addBook(app, { stock: 5 });
      await request(app).post("/internal/books/reserve").send({ items: [{ bookId: book.id, quantity: 4 }] });
      const res = await request(app).post("/internal/books/release").send({ items: [{ bookId: book.id, quantity: 4 }] });
      expect(res.status).toBe(200);
      expect(await stockOf(book.id)).toBe(5);
    });

    it("skips unknown books on release", async () => {
      const res = await request(app).post("/internal/books/release").send({ items: [{ bookId: "gone", quantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.released).toBe(0);
    });
  });
});
