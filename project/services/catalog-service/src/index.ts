import { createApp } from "./app.js";
import { startConsumer } from "./consumer.js";
import { openDb } from "./db.js";
import { handleMessage } from "./handlers.js";
import { seedBooks } from "./seed.js";

const port = Number(process.env.PORT ?? 3002);
const db = openDb(process.env.DB_PATH ?? "./data/catalog.sqlite");

if (process.env.SEED_BOOKS !== "false") {
  seedBooks(db);
}

// When an order is cancelled, its reserved stock is given back.
startConsumer({
  url: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  queue: "catalog.order-cancelled",
  bindings: ["order.cancelled"],
  handle: (raw) => {
    handleMessage(db, raw);
  },
});

createApp(db).listen(port, () => {
  console.log(`catalog-service listening on http://localhost:${port}`);
});
