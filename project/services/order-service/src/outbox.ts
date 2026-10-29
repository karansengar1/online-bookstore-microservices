import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

/** Sends one message to the broker. Rejects if the broker cannot be reached. */
export interface EventPublisher {
  publish(routingKey: string, payload: string): Promise<void>;
}

/** Saves an event in the outbox table. Call it inside the same transaction that changes the order. */
export function enqueueEvent(db: Db, type: string, data: unknown): void {
  const eventId = randomUUID();
  const now = new Date().toISOString();
  const envelope = { eventId, type, occurredAt: now, data };
  db.prepare("INSERT INTO outbox (id, routing_key, payload, created_at) VALUES (?, ?, ?, ?)").run(
    eventId,
    type,
    JSON.stringify(envelope),
    now,
  );
}

/**
 * Sends the unsent outbox events to the broker, oldest first. If the broker is down the events
 * simply stay in the table and are tried again on the next round, so no order ever loses its event.
 */
export function createOutboxDispatcher(db: Db, publisher: EventPublisher) {
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  let lastError: string | undefined;

  async function flush(): Promise<number> {
    if (running) return 0; // never run two rounds at the same time
    running = true;
    let sent = 0;
    try {
      const rows = db
        .prepare("SELECT id, routing_key, payload FROM outbox WHERE published_at IS NULL ORDER BY rowid LIMIT 50")
        .all() as { id: string; routing_key: string; payload: string }[];
      for (const row of rows) {
        try {
          await publisher.publish(row.routing_key, row.payload);
        } catch (err) {
          // Stop here to keep the events in order, and try again next round.
          const message = err instanceof Error ? err.message : String(err);
          if (message !== lastError) console.warn(`Outbox: cannot reach the broker (${message}). Will retry.`);
          lastError = message;
          break;
        }
        db.prepare("UPDATE outbox SET published_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
        lastError = undefined;
        sent += 1;
      }
    } finally {
      running = false;
    }
    return sent;
  }

  return {
    flush,
    start(intervalMs = 1000) {
      timer = setInterval(() => {
        flush().catch((err) => console.error("Outbox error:", err));
      }, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
