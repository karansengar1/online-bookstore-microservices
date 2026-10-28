import express, { type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, UserRow } from "./db.js";

export interface AppConfig {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
}

const registerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** What we send back about a user. The password hash is never included. */
function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function createApp(db: Db, config: AppConfig) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "user-service" });
  });

  // POST /api/auth/register  -> creates a CUSTOMER account
  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { name, password } = parsed.data;
    const email = parsed.data.email.toLowerCase();

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const user: UserRow = {
      id: randomUUID(),
      email,
      password_hash: await bcrypt.hash(password, 10),
      name,
      role: "CUSTOMER", // new users are always customers; admins cannot be self-registered
      created_at: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(user.id, user.email, user.password_hash, user.name, user.role, user.created_at);

    res.status(201).json(publicUser(user));
  });

  // POST /api/auth/login  -> returns a signed JWT
  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;

    // Same message for "unknown email" and "wrong password" so attackers learn nothing.
    const passwordOk = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
    if (!user || !passwordOk) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = jwt.sign({ role: user.role }, config.jwtSecret, {
      subject: user.id,
      algorithm: "HS256",
      expiresIn: config.jwtExpiresInSeconds,
    });
    res.json({ token });
  });

  // GET /api/users/me  -> the caller's own profile. The gateway sets X-User-Id after checking the JWT.
  app.get("/api/users/me", (req, res) => {
    const userId = req.header("x-user-id");
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(publicUser(user));
  });

  // GET /api/users  -> list of all users, admins only
  app.get("/api/users", (req, res) => {
    if (req.header("x-user-role") !== "ADMIN") {
      res.status(403).json({ error: "Admins only" });
      return;
    }
    const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[];
    res.json(rows.map(publicUser));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handler: bad JSON becomes 400, everything else 500 (details are only logged).
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
