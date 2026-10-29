import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db.js";
import { handleMessage } from "../src/handlers.js";
import { createRepo, type Repo } from "../src/repo.js";

const placed = (eventId: string, userId: string) =>
  JSON.stringify({ eventId, type: "order.placed", occurredAt: new Date().toISOString(), data: { orderId: "o1", userId, totalCents: 100, items: [] } });

describe("order.placed handler", () => {
  let db: Db;
  let repo: Repo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = createRepo(db);
    repo.setQuantity("anna", "b1", 2);
    repo.setQuantity("ben", "b2", 1);
  });

  it("empties the cart of the user who placed the order, and only that cart", () => {
    expect(handleMessage(db, repo, placed("e1", "anna"))).toBe("processed");
    expect(repo.getItems("anna")).toEqual([]);
    expect(repo.getItems("ben")).toHaveLength(1);
  });

  it("does nothing the second time the same event arrives", () => {
    handleMessage(db, repo, placed("e1", "anna"));
    repo.setQuantity("anna", "b3", 1); // the customer started a new cart
    expect(handleMessage(db, repo, placed("e1", "anna"))).toBe("duplicate");
    expect(repo.getItems("anna")).toEqual([{ bookId: "b3", quantity: 1 }]);
  });

  it("ignores other event types", () => {
    const other = JSON.stringify({ eventId: "e2", type: "order.shipped", occurredAt: "x", data: { userId: "anna" } });
    expect(handleMessage(db, repo, other)).toBe("ignored");
    expect(repo.getItems("anna")).toHaveLength(1);
  });

  it("throws on garbage, so the consumer retries and finally dead-letters it", () => {
    expect(() => handleMessage(db, repo, "not json")).toThrow();
    expect(() => handleMessage(db, repo, JSON.stringify({ eventId: "e3", type: "order.placed", occurredAt: "x", data: {} }))).toThrow();
  });
});
