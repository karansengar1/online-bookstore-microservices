# API Gateway

Single entry point: JWT verification, routing to the services, CORS. Port **3000**.

**Status:** implemented and tested. WebSocket pass-through is added together with the Notification Service.

## What it does

- Public routes: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/books...`, `GET /health`.
- Every other `/api/*` route needs `Authorization: Bearer <JWT>`. The gateway verifies the token and passes `X-User-Id` and `X-User-Role` to the service. Identity headers sent by the client are always removed.
- Routes by prefix: `/api/auth`, `/api/users` → User; `/api/books` → Catalog; `/api/cart` → Cart; `/api/orders` → Order; `/api/notifications` → Notification.
- `/internal/*` is never forwarded.
- A service that is down gives `503 Service unavailable`.

## Run and test

From the `project/` folder:

```
npm install
npm run dev:gateway   # starts on http://localhost:3000
npm test -w gateway
```

## Configuration (environment variables)

| Variable                   | Default                  |
| -------------------------- | ------------------------ |
| `PORT`                     | `3000`                   |
| `JWT_SECRET`               | `dev-secret-change-me`   |
| `CORS_ORIGIN`              | `http://localhost:5173`  |
| `USER_SERVICE_URL`         | `http://localhost:3001`  |
| `CATALOG_SERVICE_URL`      | `http://localhost:3002`  |
| `CART_SERVICE_URL`         | `http://localhost:3003`  |
| `ORDER_SERVICE_URL`        | `http://localhost:3004`  |
| `NOTIFICATION_SERVICE_URL` | `http://localhost:3005`  |
