import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

/** Opens the SQLite file (or an in-memory database for tests) and creates the tables. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS carts (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id       TEXT PRIMARY KEY,
      cart_id  TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      book_id  TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      UNIQUE (cart_id, book_id)
    );
  `);
  return db;
}
