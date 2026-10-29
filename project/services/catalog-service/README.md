# Catalog Service

Books, search and stock reservation. Owns the `books` data. Port **3002**.

**Status:** implemented and tested. See the [API reference](../../docs/05-api-reference.md) for the design.

## Public endpoints (through the gateway)

| Method | Path             | Access | Description                                          |
| ------ | ---------------- | ------ | ---------------------------------------------------- |
| GET    | `/api/books`     | Public | List books. Query: `q` (title or author), `page`, `pageSize` (max 100) |
| GET    | `/api/books/:id` | Public | One book                                             |
| POST   | `/api/books`     | Admin  | Create a book                                        |
| PUT    | `/api/books/:id` | Admin  | Replace a book's fields, including stock             |
| DELETE | `/api/books/:id` | Admin  | Delete a book                                        |

A book looks like `{ id, title, author, isbn, priceCents, stock, description }`. Money is always in cents.

## Internal endpoints (service to service only, blocked by the gateway)

| Method | Path                     | Used by | Description                                                                 |
| ------ | ------------------------ | ------- | --------------------------------------------------------------------------- |
| GET    | `/internal/books/:id`    | Cart    | Does this book exist?                                                       |
| POST   | `/internal/books/reserve` | Order  | Body `{ items: [{ bookId, quantity }] }`. All-or-nothing. Returns `{ items: [{ bookId, title, priceCents, quantity }] }`, or 409 (not enough stock) / 404 (unknown book) with the `bookId` |
| POST   | `/internal/books/release` | Order  | Gives reserved stock back (failed or cancelled order)                       |

## Events

Listens on the queue `catalog.order-cancelled` (bound to `order.cancelled`). When an order is cancelled, the stock of its items goes back to the shelves. Each event id is saved, so the stock is never given back twice; a message that keeps failing is dead-lettered to `catalog.order-cancelled.dlq`.

## Run and test

From the `project/` folder:

```
npm install
npm run dev:catalog        # starts on http://localhost:3002
npm test -w services/catalog-service
```

On first start the catalogue is filled with 8 demo books (placeholder ISBNs `DEMO-0001`…). Set `SEED_BOOKS=false` to turn that off.

## Configuration (environment variables)

| Variable      | Default                | Meaning                    |
| ------------- | ---------------------- | -------------------------- |
| `PORT`        | `3002`                 | Port to listen on          |
| `DB_PATH`     | `./data/catalog.sqlite` | SQLite file               |
| `SEED_BOOKS`  | `true`                 | Add demo books when empty  |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | RabbitMQ for the cancel events |
