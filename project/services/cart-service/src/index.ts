import { createApp } from "./app.js";
import { createCatalogClient } from "./catalog-client.js";
import { startConsumer } from "./consumer.js";
import { openDb } from "./db.js";
import { handleMessage } from "./handlers.js";
import { createRepo } from "./repo.js";

const port = Number(process.env.PORT ?? 3003);
const db = openDb(process.env.DB_PATH ?? "./data/cart.sqlite");
const catalog = createCatalogClient(process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002");

// When an order is placed, the cart has become an order and is emptied.
const repo = createRepo(db);
startConsumer({
  url: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  queue: "cart.order-placed",
  bindings: ["order.placed"],
  handle: (raw) => {
    handleMessage(db, repo, raw);
  },
});

createApp(db, catalog).listen(port, () => {
  console.log(`cart-service listening on http://localhost:${port}`);
});
