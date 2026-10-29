import amqp, { type ConsumeMessage } from "amqplib";

const EXCHANGE = "bookstore.events";
const DEAD_LETTER_EXCHANGE = "bookstore.dlx";
const MAX_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 3000;

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type Channel = Awaited<ReturnType<Connection["createChannel"]>>;

export interface ConsumerOptions {
  url: string;
  /** Every consuming service has its own durable queue. */
  queue: string;
  /** Routing keys this queue listens to, for example ["order.placed"]. */
  bindings: string[];
  /** Processes one message. Throwing means "failed": the message is retried, then dead-lettered. */
  handle: (raw: string) => void | Promise<void>;
}

/**
 * Listens to the RabbitMQ topic exchange. If the broker is not reachable it keeps trying every
 * few seconds, so the service can start before RabbitMQ and survive a RabbitMQ restart.
 *
 * A failed message is put back on the queue up to 3 times. After that it is rejected and
 * RabbitMQ moves it to the dead-letter queue "<queue>.dlq", where it can be inspected.
 */
export function startConsumer(options: ConsumerOptions) {
  let stopped = false;
  let connection: Connection | undefined;
  let lastError: string | undefined;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function handleMessage(channel: Channel, message: ConsumeMessage) {
    try {
      await options.handle(message.content.toString());
      channel.ack(message);
    } catch (err) {
      const attempts = Number(message.properties.headers?.["x-attempts"] ?? 0) + 1;
      console.error(
        `Consumer ${options.queue}: processing failed (attempt ${attempts} of ${MAX_ATTEMPTS}):`,
        err instanceof Error ? err.message : err,
      );
      try {
        if (attempts < MAX_ATTEMPTS) {
          channel.sendToQueue(options.queue, message.content, {
            persistent: true,
            headers: { ...message.properties.headers, "x-attempts": attempts },
          });
          channel.ack(message);
        } else {
          channel.nack(message, false, false); // goes to the dead-letter queue
        }
      } catch {
        // The channel is gone. RabbitMQ will deliver the message again after reconnecting.
      }
    }
  }

  async function run() {
    while (!stopped) {
      try {
        const conn = await amqp.connect(options.url);
        connection = conn;
        conn.on("error", () => {});
        const closed = new Promise<void>((resolve) => conn.on("close", () => resolve()));

        const channel = await conn.createChannel();
        await channel.assertExchange(EXCHANGE, "topic", { durable: true });
        await channel.assertExchange(DEAD_LETTER_EXCHANGE, "direct", { durable: true });
        await channel.assertQueue(`${options.queue}.dlq`, { durable: true });
        await channel.bindQueue(`${options.queue}.dlq`, DEAD_LETTER_EXCHANGE, options.queue);
        await channel.assertQueue(options.queue, {
          durable: true,
          arguments: { "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE, "x-dead-letter-routing-key": options.queue },
        });
        for (const key of options.bindings) {
          await channel.bindQueue(options.queue, EXCHANGE, key);
        }
        await channel.prefetch(10);
        await channel.consume(options.queue, (message) => {
          if (message) void handleMessage(channel, message);
        });

        lastError = undefined;
        console.log(`Consumer ${options.queue}: connected to RabbitMQ`);
        await closed;
        if (!stopped) console.warn(`Consumer ${options.queue}: lost the connection to RabbitMQ, reconnecting...`);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (text !== lastError) console.warn(`Consumer ${options.queue}: cannot reach RabbitMQ (${text}). Will retry.`);
        lastError = text;
      }
      connection = undefined;
      if (!stopped) await sleep(RECONNECT_DELAY_MS);
    }
  }

  void run();

  return {
    async stop() {
      stopped = true;
      await connection?.close().catch(() => {});
    },
  };
}
