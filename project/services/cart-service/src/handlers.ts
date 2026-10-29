import { z } from "zod";
import type { Db } from "./db.js";
import { parseEnvelope } from "./events.js";
import { processOnce } from "./inbox.js";
import type { Repo } from "./repo.js";

const orderPlacedData = z.object({ userId: z.string().min(1) });

export type Outcome = "processed" | "duplicate" | "ignored";

/** order.placed -> the customer's cart is emptied, because it has become an order. */
export function handleMessage(db: Db, repo: Repo, raw: string): Outcome {
  const event = parseEnvelope(raw);
  if (event.type !== "order.placed") return "ignored";
  const { userId } = orderPlacedData.parse(event.data);
  return processOnce(db, event.eventId, () => repo.clear(userId)) ? "processed" : "duplicate";
}
