import http from "node:http";
import { createApp } from "./app.js";
import { startConsumer } from "./consumer.js";
import { openDb } from "./db.js";
import { handleMessage } from "./handlers.js";
import { createHub } from "./hub.js";
import { attachWebSocket } from "./ws-server.js";

const port = Number(process.env.PORT ?? 3005);
const db = openDb(process.env.DB_PATH ?? "./data/notifications.sqlite");
const hub = createHub();

// REST and WebSocket share one HTTP server.
const server = http.createServer(createApp(db));
attachWebSocket(server, hub);

// Every order event becomes a stored notification, pushed live to the customer.
startConsumer({
  url: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  queue: "notification.orders",
  bindings: ["order.*"],
  handle: (raw) => {
    handleMessage(db, hub, raw);
  },
});

server.listen(port, () => {
  console.log(`notification-service listening on http://localhost:${port}`);
});
