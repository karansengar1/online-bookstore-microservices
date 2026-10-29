import express, { type NextFunction, type Request, type Response } from "express";
import type { Db, NotificationRow } from "./db.js";

function present(row: NotificationRow) {
  return { id: row.id, kind: row.kind, message: row.message, isRead: row.is_read === 1, createdAt: row.created_at };
}

export function createApp(db: Db) {
  const app = express();
  app.use(express.json());

  /** The gateway sets X-User-Id after checking the JWT. */
  function currentUser(req: Request, res: Response): string | undefined {
    const userId = req.header("x-user-id");
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return undefined;
    }
    return userId;
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "notification-service" });
  });

  // GET /api/notifications  -> the caller's notifications, newest first. Also used to catch up after a reconnect.
  app.get("/api/notifications", (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;
    const rows = db
      .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50")
      .all(userId) as NotificationRow[];
    res.json(rows.map(present));
  });

  // PATCH /api/notifications/:id/read
  app.patch("/api/notifications/:id/read", (req, res) => {
    const userId = currentUser(req, res);
    if (!userId) return;
    const result = db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(String(req.params.id), userId);
    if (result.changes === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ id: String(req.params.id), isRead: true });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
