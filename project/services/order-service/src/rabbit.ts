import amqp from "amqplib";
import type { EventPublisher } from "./outbox.js";

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type Channel = Awaited<ReturnType<Connection["createConfirmChannel"]>>;

export const EXCHANGE = "bookstore.events";

/**
 * Publishes events to the RabbitMQ topic exchange. It connects when the first message is sent,
 * and after a failure it reconnects on the next attempt.
 */
export function createRabbitPublisher(url: string): EventPublisher {
  let connection: Connection | undefined;
  let channel: Channel | undefined;

  function reset() {
    channel = undefined;
    connection?.close().catch(() => {});
    connection = undefined;
  }

  async function getChannel(): Promise<Channel> {
    if (channel) return channel;
    const conn = await amqp.connect(url);
    conn.on("error", () => {}); // errors are handled by the next publish attempt
    conn.on("close", () => {
      channel = undefined;
      connection = undefined;
    });
    const ch = await conn.createConfirmChannel();
    await ch.assertExchange(EXCHANGE, "topic", { durable: true });
    connection = conn;
    channel = ch;
    return ch;
  }

  return {
    async publish(routingKey, payload) {
      try {
        const ch = await getChannel();
        // Wait for the broker's confirmation, so "published" really means "the broker has it".
        await new Promise<void>((resolve, reject) => {
          ch.publish(EXCHANGE, routingKey, Buffer.from(payload), { persistent: true, contentType: "application/json" }, (err) =>
            err ? reject(err) : resolve(),
          );
        });
      } catch (err) {
        reset();
        throw err;
      }
    },
  };
}
