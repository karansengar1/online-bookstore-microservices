import { createApp } from "./app.js";
import { createCartClient, createCatalogClient } from "./clients.js";
import { openDb } from "./db.js";
import { createOutboxDispatcher } from "./outbox.js";
import { createRabbitPublisher } from "./rabbit.js";

const port = Number(process.env.PORT ?? 3004);
const db = openDb(process.env.DB_PATH ?? "./data/orders.sqlite");

const app = createApp(db, {
  cart: createCartClient(process.env.CART_SERVICE_URL ?? "http://localhost:3003"),
  catalog: createCatalogClient(process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002"),
});

// Events saved in the outbox are sent to RabbitMQ in the background. Orders work even if RabbitMQ is down.
const dispatcher = createOutboxDispatcher(db, createRabbitPublisher(process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672"));
dispatcher.start(1000);

app.listen(port, () => {
  console.log(`order-service listening on http://localhost:${port}`);
});
