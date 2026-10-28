import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BookRow, Db } from "./db.js";

const bookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(200),
  isbn: z.string().trim().min(5).max(30),
  priceCents: z.number().int().min(0),
  stock: z.number().int().min(0),
  description: z.string().max(2000).optional(),
});

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const itemsSchema = z.object({
  items: z
    .array(z.object({ bookId: z.string().min(1), quantity: z.number().int().min(1) }))
    .min(1)
    .max(100),
});

/** Thrown inside the reservation transaction so that SQLite rolls everything back. */
class ReservationError extends Error {
  constructor(
    readonly kind: "not_found" | "insufficient",
    readonly bookId: string,
  ) {
    super(kind);
  }
}

/** The shape we send to clients (camelCase), built from a database row. */
function toBook(row: BookRow) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    priceCents: row.price_cents,
    stock: row.stock,
    description: row.description,
  };
}

/** The same book listed twice in one request is counted as one line with the summed quantity. */
function mergeItems(items: { bookId: string; quantity: number }[]): [string, number][] {
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.bookId, (merged.get(item.bookId) ?? 0) + item.quantity);
  }
  return [...merged];
}

function isAdmin(req: Request): boolean {
  // The gateway has already verified the JWT and set this header.
  return req.header("x-user-role") === "ADMIN";
}

export function createApp(db: Db) {
  const app = express();
  app.use(express.json());

  const getById = db.prepare("SELECT * FROM books WHERE id = ?");

  // All-or-nothing: if one book fails, the transaction is rolled back and no stock changes.
  const reserveStock = db.transaction((lines: [string, number][]) => {
    const reserved: { bookId: string; title: string; priceCents: number; quantity: number }[] = [];
    for (const [bookId, quantity] of lines) {
      const book = getById.get(bookId) as BookRow | undefined;
      if (!book) throw new ReservationError("not_found", bookId);
      if (book.stock < quantity) throw new ReservationError("insufficient", bookId);
      db.prepare("UPDATE books SET stock = stock - ? WHERE id = ?").run(quantity, bookId);
      reserved.push({ bookId, title: book.title, priceCents: book.price_cents, quantity });
    }
    return reserved;
  });

  const releaseStock = db.transaction((lines: [string, number][]) => {
    let released = 0;
    for (const [bookId, quantity] of lines) {
      // A book that was deleted in the meantime is simply skipped.
      const result = db.prepare("UPDATE books SET stock = stock + ? WHERE id = ?").run(quantity, bookId);
      released += result.changes;
    }
    return released;
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "catalog-service" });
  });

  // GET /api/books?q=&page=&pageSize=   (public)
  app.get("/api/books", (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { q, page, pageSize } = parsed.data;

    let where = "";
    const params: string[] = [];
    if (q) {
      // Escape LIKE wildcards so a search for "100%" is taken literally.
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where = "WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\'";
      params.push(like, like);
    }

    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM books ${where}`).get(...params) as { n: number };
    const rows = db
      .prepare(`SELECT * FROM books ${where} ORDER BY title LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as BookRow[];

    res.json({ items: rows.map(toBook), page, pageSize, total: n });
  });

  // GET /api/books/:id   (public)
  app.get("/api/books/:id", (req, res) => {
    const row = getById.get(String(req.params.id)) as BookRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    res.json(toBook(row));
  });

  // POST /api/books   (admin)
  app.post("/api/books", (req, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Admins only" });
      return;
    }
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const data = parsed.data;
    if (db.prepare("SELECT id FROM books WHERE isbn = ?").get(data.isbn)) {
      res.status(409).json({ error: "A book with this ISBN already exists" });
      return;
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO books (id, title, author, isbn, price_cents, stock, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, data.title, data.author, data.isbn, data.priceCents, data.stock, data.description ?? "", new Date().toISOString());
    res.status(201).json(toBook(getById.get(id) as BookRow));
  });

  // PUT /api/books/:id   (admin) - replaces all fields, including stock
  app.put("/api/books/:id", (req, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Admins only" });
      return;
    }
    const id = String(req.params.id);
    if (!getById.get(id)) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const data = parsed.data;
    if (db.prepare("SELECT id FROM books WHERE isbn = ? AND id != ?").get(data.isbn, id)) {
      res.status(409).json({ error: "A book with this ISBN already exists" });
      return;
    }
    db.prepare(
      "UPDATE books SET title = ?, author = ?, isbn = ?, price_cents = ?, stock = ?, description = ? WHERE id = ?",
    ).run(data.title, data.author, data.isbn, data.priceCents, data.stock, data.description ?? "", id);
    res.json(toBook(getById.get(id) as BookRow));
  });

  // DELETE /api/books/:id   (admin)
  app.delete("/api/books/:id", (req, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Admins only" });
      return;
    }
    const result = db.prepare("DELETE FROM books WHERE id = ?").run(String(req.params.id));
    if (result.changes === 0) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    res.status(204).end();
  });

  // ---- Internal endpoints: used by other services, never reachable through the gateway ----

  // GET /internal/books/:id   (used by the Cart service to check that a book exists)
  app.get("/internal/books/:id", (req, res) => {
    const row = getById.get(String(req.params.id)) as BookRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    res.json(toBook(row));
  });

  // POST /internal/books/reserve   (used by the Order service)
  app.post("/internal/books/reserve", (req, res) => {
    const parsed = itemsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      const reserved = reserveStock(mergeItems(parsed.data.items));
      res.json({ items: reserved });
    } catch (err) {
      if (err instanceof ReservationError) {
        res
          .status(err.kind === "not_found" ? 404 : 409)
          .json({ error: err.kind === "not_found" ? "Book not found" : "Not enough stock", bookId: err.bookId });
        return;
      }
      throw err;
    }
  });

  // POST /internal/books/release   (undo a reservation, used when an order fails or is cancelled)
  app.post("/internal/books/release", (req, res) => {
    const parsed = itemsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    res.json({ released: releaseStock(mergeItems(parsed.data.items)) });
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
