import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

// Demo data so the shop is not empty on first start. The ISBNs are placeholders.
const DEMO_BOOKS = [
  ["Clean Code", "Robert C. Martin", 3990, 15, "A handbook of agile software craftsmanship."],
  ["The Pragmatic Programmer", "Andrew Hunt, David Thomas", 4290, 12, "Your journey to mastery."],
  ["Designing Data-Intensive Applications", "Martin Kleppmann", 5490, 10, "The big ideas behind reliable, scalable systems."],
  ["Building Microservices", "Sam Newman", 4990, 14, "Designing fine-grained systems."],
  ["Refactoring", "Martin Fowler", 4690, 9, "Improving the design of existing code."],
  ["Domain-Driven Design", "Eric Evans", 5290, 8, "Tackling complexity in the heart of software."],
  ["Release It!", "Michael T. Nygard", 4590, 7, "Design and deploy production-ready software."],
  ["Continuous Delivery", "Jez Humble, David Farley", 4890, 11, "Reliable software releases through automation."],
] as const;

/** Adds the demo books, but only if the catalogue is still empty. */
export function seedBooks(db: Db): void {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number };
  if (n > 0) return;
  const insert = db.prepare(
    "INSERT INTO books (id, title, author, isbn, price_cents, stock, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    DEMO_BOOKS.forEach(([title, author, price, stock, description], i) => {
      insert.run(randomUUID(), title, author, `DEMO-${String(i + 1).padStart(4, "0")}`, price, stock, description, now);
    });
  })();
}
