# Order Service

Turns a cart into an order, manages the order lifecycle and publishes order events. Owns `orders`, `order_items` and the `outbox`. Port **3004**.

**Status:** implemented and tested. See the [API reference](../../docs/05-api-reference.md), the [communication page](../../docs/03-communication.md) and the order-state diagram for the design.

## Placing an order

`POST /api/orders` does three things in this order:

1. Asks the **Cart service** for the caller's cart lines (REST).
2. Asks the **Catalog service** to reserve the stock, all-or-nothing (REST). The answer also carries each book's title and price, which are stored as a snapshot in the order.
3. Saves the order, its items and an `order.placed` event **in one database transaction**. If this fails, the reserved stock is released again (compensation).

The event is not sent to RabbitMQ inside the request. It sits in the `outbox` table and a background loop sends it (the **outbox pattern**). So an order is valid even when RabbitMQ is down, and the event is sent as soon as the broker is back.

## Endpoints (through the gateway, login required)

| Method | Path                     | Access           | Description                                                  |
| ------ | ------------------------ | ---------------- | ------------------------------------------------------------ |
| POST   | `/api/orders`            | Customer         | Create an order from the cart (`201`)                         |
| GET    | `/api/orders`            | Customer / Admin | Own orders; admins see all                                   |
| GET    | `/api/orders/:id`        | Owner or Admin   | One order with items (`404` for everyone else)               |
| POST   | `/api/orders/:id/cancel` | Owner or Admin   | Cancel, only while `PLACED`                                  |
| PATCH  | `/api/orders/:id/status` | Admin            | `{ "status": "SHIPPED" }` or `{ "status": "DELIVERED" }`     |

Errors: empty cart `400`, not enough stock `409` (with `bookId`), Cart or Catalog service down `503`, illegal status step `409`.

## Events (RabbitMQ topic exchange `bookstore.events`)

`order.placed`, `order.shipped`, `order.delivered`, `order.cancelled`. Every message is `{ eventId, type, occurredAt, data }`. See the [data model](../../docs/04-data-model.md).

## Run and test

From the `project/` folder:

```
npm install
npm test -w services/order-service      # needs no Docker
npm run infra:up                        # starts RabbitMQ in Docker
npm run dev:order                       # starts on http://localhost:3004
```

RabbitMQ's management page: http://localhost:15672 (user `guest`, password `guest`).

## Configuration (environment variables)

| Variable              | Default                              |
| --------------------- | ------------------------------------ |
| `PORT`                | `3004`                               |
| `DB_PATH`             | `./data/orders.sqlite`               |
| `CART_SERVICE_URL`    | `http://localhost:3003`              |
| `CATALOG_SERVICE_URL` | `http://localhost:3002`              |
| `RABBITMQ_URL`        | `amqp://guest:guest@localhost:5672`  |
