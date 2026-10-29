import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db.js";
import { handleMessage } from "../src/handlers.js";

const cancelled = (eventId: string, items: { bookId: string; quantity: number }[]) =>
  JSON.stringify({ eventId, type: "order.cancelled", occurredAt: new Date().toISOString(), data: { orderId: "o1", userId: "anna", items } });

describe("order.cancelled handler", () => {
  let db: Db;
  const stockOf = (id: string) => (db.prepare("SELECT stock FROM books WHERE id = ?").get(id) as { stock: number }).stock;

  beforeEach(() => {
    db = openDb(":memory:");
    const insert = db.prepare("INSERT INTO books (id, title, author, isbn, price_cents, stock, description, created_at) VALUES (?, ?, 'A', ?, 100, ?, '', 'now')");
    insert.run("b1", "One", "ISBN-1", 3);
    insert.run("b2", "Two", "ISBN-2", 0);
  });

  it("gives the stock of every cancelled item back", () => {
    expect(handleMessage(db, cancelled("e1", [{ bookId: "b1", quantity: 2 }, { bookId: "b2", quantity: 1 }]))).toBe("processed");
    expect(stockOf("b1")).toBe(5);
    expect(stockOf("b2")).toBe(1);
  });

  it("does not give the stock back twice when the same event arrives again", () => {
    handleMessage(db, cancelled("e1", [{ bookId: "b1", quantity: 2 }]));
    expect(handleMessage(db, cancelled("e1", [{ bookId: "b1", quantity: 2 }]))).toBe("duplicate");
    expect(stockOf("b1")).toBe(5);
  });

  it("skips books that no longer exist", () => {
    expect(handleMessage(db, cancelled("e2", [{ bookId: "gone", quantity: 1 }, { bookId: "b1", quantity: 1 }]))).toBe("processed");
    expect(stockOf("b1")).toBe(4);
  });

  it("ignores other event types and throws on garbage", () => {
    const placed = JSON.stringify({ eventId: "e3", type: "order.placed", occurredAt: "x", data: {} });
    expect(handleMessage(db, placed)).toBe("ignored");
    expect(() => handleMessage(db, "not json")).toThrow();
    expect(() => handleMessage(db, JSON.stringify({ eventId: "e4", type: "order.cancelled", occurredAt: "x", data: { items: [{ bookId: "b1", quantity: 0 }] } }))).toThrow();
  });
});
