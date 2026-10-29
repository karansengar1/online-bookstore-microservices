import { z } from "zod";

/** Every message on the exchange has this envelope. */
const envelopeSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  occurredAt: z.string(),
  data: z.unknown(),
});

export type EventEnvelope = z.infer<typeof envelopeSchema>;

/** Throws if the message is not valid JSON or has the wrong shape (the consumer then retries and dead-letters it). */
export function parseEnvelope(raw: string): EventEnvelope {
  return envelopeSchema.parse(JSON.parse(raw));
}
