import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export type OrderStatus = "PLACED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

export interface OrderRow {
  id: string;
  user_id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  book_id: string;
  title_snapshot: string;
  unit_price_cents: number;
  quantity: number;
}

/** Opens the SQLite file (or an in-memory database for tests) and creates the tables. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('PLACED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id               TEXT PRIMARY KEY,
      order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      book_id          TEXT NOT NULL,
      title_snapshot   TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity         INTEGER NOT NULL CHECK (quantity >= 1)
    );
    -- The outbox: events are saved here together with the order, then sent to RabbitMQ.
    CREATE TABLE IF NOT EXISTS outbox (
      id           TEXT PRIMARY KEY,
      routing_key  TEXT NOT NULL,
      payload      TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      published_at TEXT
    );
  `);
  return db;
}
