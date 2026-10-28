import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: "CUSTOMER" | "ADMIN";
  created_at: string;
}

/** Opens the SQLite file (or an in-memory database for tests) and creates the table. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('CUSTOMER', 'ADMIN')),
      created_at    TEXT NOT NULL
    )
  `);
  return db;
}
