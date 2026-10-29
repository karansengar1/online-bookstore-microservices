import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  message: string;
  is_read: number;
  created_at: string;
}

/** Opens the SQLite file (or an in-memory database for tests) and creates the tables. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      message    TEXT NOT NULL,
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at);
    -- ids of the events already handled, so a repeated event does nothing
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id     TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
  `);
  return db;
}
