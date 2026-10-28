import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

/** Makes sure one admin account exists, so the admin features can be used and demonstrated. */
export async function seedAdmin(db: Db, email: string, password: string): Promise<void> {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return;
  const hash = await bcrypt.hash(password, 10);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), email.toLowerCase(), hash, "Administrator", "ADMIN", new Date().toISOString());
}
