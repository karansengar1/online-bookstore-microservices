# Cart Service

One cart per customer. Owns `carts` and `cart_items`. Port **3003**.

**Status:** implemented and tested. See the [API reference](../../docs/05-api-reference.md) for the design.

The cart stores only book ids and quantities. Titles and prices are always asked from the Catalog service, so they can never be out of date.

## Endpoints (through the gateway, login required)

| Method | Path                      | Description                                                              |
| ------ | ------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/cart`               | The cart with title, price and line total of each book, plus `totalCents` |
| POST   | `/api/cart/items`         | Add `{ bookId, quantity }`; adds to the quantity already in the cart     |
| PATCH  | `/api/cart/items/:bookId` | Set the quantity `{ quantity }`                                          |
| DELETE | `/api/cart/items/:bookId` | Remove one book                                                          |
| DELETE | `/api/cart`               | Empty the cart                                                           |

Adding or changing checks the Catalog service: unknown book → `404`, more than in stock → `409` (with `available`), Catalog service down → `503`. Viewing the cart still works when the Catalog service is down: items come back without details, `catalogAvailable` is `false` and `totalCents` is `null`.

## Internal endpoint (service to service only, blocked by the gateway)

| Method | Path                      | Used by | Description                                   |
| ------ | ------------------------- | ------- | --------------------------------------------- |
| GET    | `/internal/carts/:userId` | Order   | Raw cart lines `{ userId, items: [{ bookId, quantity }] }` |

## Events

Listens on the queue `cart.order-placed` (bound to `order.placed`). When an order is placed, the customer's cart is emptied. Each event id is saved, so a repeated event does nothing; a message that keeps failing is dead-lettered to `cart.order-placed.dlq`.

## Run and test

From the `project/` folder:

```
npm install
npm run dev:cart           # starts on http://localhost:3003 (needs the Catalog service for details)
npm test -w services/cart-service
```

## Configuration (environment variables)

| Variable              | Default                 | Meaning                          |
| --------------------- | ----------------------- | -------------------------------- |
| `PORT`                | `3003`                  | Port to listen on                |
| `DB_PATH`             | `./data/cart.sqlite`    | SQLite file                      |
| `CATALOG_SERVICE_URL` | `http://localhost:3002` | Where the Catalog service runs   |
| `RABBITMQ_URL`        | `amqp://guest:guest@localhost:5672` | RabbitMQ (events are optional for the REST part) |
