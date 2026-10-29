import { z } from "zod";
import type { Db } from "./db.js";
import { parseEnvelope } from "./events.js";
import { processOnce } from "./inbox.js";

const orderCancelledData = z.object({
  items: z.array(z.object({ bookId: z.string().min(1), quantity: z.number().int().min(1) })),
});

export type Outcome = "processed" | "duplicate" | "ignored";

/** order.cancelled -> the reserved stock of the order goes back to the shelves. */
export function handleMessage(db: Db, raw: string): Outcome {
  const event = parseEnvelope(raw);
  if (event.type !== "order.cancelled") return "ignored";
  const { items } = orderCancelledData.parse(event.data);
  return processOnce(db, event.eventId, () => {
    // A book that was deleted in the meantime is simply skipped (the UPDATE matches no row).
    const restock = db.prepare("UPDATE books SET stock = stock + ? WHERE id = ?");
    for (const item of items) restock.run(item.quantity, item.bookId);
  })
    ? "processed"
    : "duplicate";
}
