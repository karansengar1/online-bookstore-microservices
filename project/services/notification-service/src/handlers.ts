import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { parseEnvelope } from "./events.js";
import type { Hub } from "./hub.js";
import { processOnce } from "./inbox.js";

const orderEventData = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  totalCents: z.number().optional(),
});

export type Outcome = "processed" | "duplicate" | "ignored";

const KNOWN_EVENTS = new Set(["order.placed", "order.shipped", "order.delivered", "order.cancelled"]);

function describe(type: string, orderId: string, totalCents: number | undefined): string {
  const label = `Order #${orderId.slice(0, 8)}`;
  switch (type) {
    case "order.placed":
      return `${label} was placed (total ${((totalCents ?? 0) / 100).toFixed(2)}).`;
    case "order.shipped":
      return `${label} has been shipped.`;
    case "order.delivered":
      return `${label} was delivered.`;
    default:
      return `${label} was cancelled.`;
  }
}

/**
 * An order event arrived: store a notification for the customer, and, only after it is safely
 * stored, push it to the customer's open browser tabs. A repeated event does neither again.
 */
export function handleMessage(db: Db, hub: Hub, raw: string): Outcome {
  const event = parseEnvelope(raw);
  if (!KNOWN_EVENTS.has(event.type)) return "ignored";

  const data = orderEventData.parse(event.data);
  const notification = {
    id: randomUUID(),
    kind: event.type,
    message: describe(event.type, data.orderId, data.totalCents),
    createdAt: new Date().toISOString(),
  };

  const isNew = processOnce(db, event.eventId, () => {
    db.prepare("INSERT INTO notifications (id, user_id, kind, message, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(
      notification.id,
      data.userId,
      notification.kind,
      notification.message,
      notification.createdAt,
    );
  });
  if (!isNew) return "duplicate";

  hub.send(data.userId, { type: "notification", data: notification });
  return "processed";
}
