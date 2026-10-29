import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string;
  price_cents: number;
  stock: number;
  description: string;
  created_at: string;
}

/** Opens the SQLite file (or an in-memory database for tests) and creates the table. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      author      TEXT NOT NULL,
      isbn        TEXT NOT NULL UNIQUE,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock       INTEGER NOT NULL CHECK (stock >= 0),
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
    -- ids of the events already handled, so a repeated event does nothing
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id     TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
  `);
  return db;
}
