# 05 API reference

[Index](README.md) · [01 Overview](01-overview.md) · [02 Architecture](02-architecture.md) · [03 Communication](03-communication.md) · [04 Data model](04-data-model.md) · [05 API](05-api-reference.md) · [06 Design decisions](06-design-decisions.md)

Base URL (through the gateway): `http://localhost:3000`. All bodies are JSON. Errors use the format `{ "error": "message" }` with a suitable HTTP status (400, 401, 403, 404, 409, 503).

Access: **Public** = no token, **Customer** = valid token, **Admin** = valid token with role `ADMIN`, **Owner or Admin** = the resource belongs to the caller, or the caller is an admin.

## Gateway routing

| Gateway path prefix        | Forwarded to           |
| -------------------------- | ---------------------- |
| `/api/auth/*`, `/api/users/*` | User Service        |
| `/api/books/*`             | Catalog Service        |
| `/api/cart/*`              | Cart Service           |
| `/api/orders/*`            | Order Service          |
| `/api/notifications/*`     | Notification Service   |
| `/internal/*`              | Never forwarded (404)  |

## User Service

| Method | Path                | Access   | Description                          |
| ------ | ------------------- | -------- | ------------------------------------ |
| POST   | `/api/auth/register` | Public  | Create a customer account            |
| POST   | `/api/auth/login`   | Public   | Returns `{ token }`                  |
| GET    | `/api/users/me`     | Customer | Own profile                          |
| GET    | `/api/users`        | Admin    | List users                           |

## Catalog Service

| Method | Path                | Access   | Description                                   |
| ------ | ------------------- | -------- | --------------------------------------------- |
| GET    | `/api/books`        | Public   | List books; query `q`, `page`, `pageSize`     |
| GET    | `/api/books/:id`    | Public   | One book                                      |
| POST   | `/api/books`        | Admin    | Create a book                                 |
| PUT    | `/api/books/:id`    | Admin    | Update a book, including stock                |
| DELETE | `/api/books/:id`    | Admin    | Delete a book                                 |

Internal (not reachable through the gateway): `POST /internal/books/reserve`, `POST /internal/books/release`, `GET /internal/books/:id`.

## Cart Service

| Method | Path                        | Access   | Description                          |
| ------ | --------------------------- | -------- | ------------------------------------ |
| GET    | `/api/cart`                 | Customer | Own cart                             |
| POST   | `/api/cart/items`           | Customer | Add `{ bookId, quantity }`           |
| PATCH  | `/api/cart/items/:bookId`   | Customer | Change quantity                      |
| DELETE | `/api/cart/items/:bookId`   | Customer | Remove an item                       |
| DELETE | `/api/cart`                 | Customer | Empty the cart                       |

`GET /api/cart` returns the lines with title, price and total, taken from the Catalog service:

```json
{
  "items": [{ "bookId": "uuid", "quantity": 2, "book": { "title": "Clean Code", "author": "Robert C. Martin", "priceCents": 3990, "stock": 15 }, "lineTotalCents": 7980 }],
  "totalCents": 7980,
  "catalogAvailable": true
}
```

Adding or changing an item answers `404` for an unknown book, `409` (with `available`) when more is requested than is in stock, and `503` when the Catalog Service is down. If the Catalog Service is down, `GET /api/cart` still works: `book` is `null`, `catalogAvailable` is `false` and `totalCents` is `null`.

Internal: `GET /internal/carts/:userId`.

## Order Service

| Method | Path                       | Access            | Description                                          |
| ------ | -------------------------- | ----------------- | ---------------------------------------------------- |
| POST   | `/api/orders`              | Customer          | Create an order from the current cart                |
| GET    | `/api/orders`              | Customer / Admin  | Own orders; admins see all                           |
| GET    | `/api/orders/:id`          | Owner or Admin    | One order with its items (`404` for everyone else)   |
| POST   | `/api/orders/:id/cancel`   | Owner or Admin    | Cancel; only while `PLACED`                          |
| PATCH  | `/api/orders/:id/status`   | Admin             | Body `{ status: "SHIPPED" or "DELIVERED" }`          |

## Notification Service

| Method | Path                          | Access   | Description                                     |
| ------ | ----------------------------- | -------- | ----------------------------------------------- |
| GET    | `/api/notifications`          | Customer | Own notifications, newest first                 |
| PATCH  | `/api/notifications/:id/read` | Customer | Mark as read                                    |
| GET    | `/api/notifications/ws`       | Customer | WebSocket upgrade; token as `?access_token=`    |

The gateway checks the token in the query string, sets `X-User-Id`, and proxies the upgrade to the Notification Service. A missing or invalid token gets `401` and no connection. Right after connecting, the server sends `{ "type": "connected" }`.

WebSocket message (server to client):

```json
{ "type": "notification", "data": { "id": "...", "kind": "order.placed", "message": "Your order was placed", "createdAt": "..." } }
```

The server sends a ping every 30 seconds and the browser answers with a pong automatically. The client sends no application messages in this version.

## Health

Every service and the gateway expose `GET /health` returning `{ "status": "ok" }`; Docker Compose uses it for health checks.
