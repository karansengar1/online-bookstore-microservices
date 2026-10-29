import type { Db } from "./db.js";

/**
 * Runs `effect` at most once per event id. RabbitMQ delivers messages "at least once",
 * so the same event can arrive twice. The id is saved in the same transaction as the effect,
 * so either both happen or neither does. Returns false if the event was already processed.
 */
export function processOnce(db: Db, eventId: string, effect: () => void): boolean {
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM processed_events WHERE event_id = ?").get(eventId)) return false;
    effect();
    db.prepare("INSERT INTO processed_events (event_id, processed_at) VALUES (?, ?)").run(eventId, new Date().toISOString());
    return true;
  })();
}
