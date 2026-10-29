# Notification Service

Listens to order events, stores a notification for the customer and pushes it live to the browser over WebSocket. Owns `notifications`. Port **3005**.

**Status:** implemented and tested. See the [communication page](../../docs/03-communication.md) for the design.

## How a notification reaches the browser

1. The Order service publishes `order.placed`, `order.shipped`, `order.delivered` or `order.cancelled` to RabbitMQ.
2. This service's queue `notification.orders` (bound to `order.*`) receives it.
3. A notification is saved in the database. The id of the event is saved in the same transaction, so a repeated event is ignored.
4. After saving, the notification is pushed to every open WebSocket connection of that customer.

If this service is down, the messages wait in its queue and are handled when it returns. A message that keeps failing is retried three times and then moved to the dead-letter queue `notification.orders.dlq`.

## Endpoints (through the gateway, login required)

| Method | Path                          | Description                                                    |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| GET    | `/api/notifications`          | The caller's last 50 notifications, newest first               |
| PATCH  | `/api/notifications/:id/read` | Mark one as read (`404` if it is not yours)                    |
| GET    | `/api/notifications/ws`       | WebSocket upgrade. Token as `?access_token=`; see below        |

## WebSocket

`ws://localhost:3000/api/notifications/ws?access_token=<JWT>` (through the gateway). Messages from the server:

```json
{ "type": "connected" }
{ "type": "notification", "data": { "id": "...", "kind": "order.placed", "message": "Order #abcdef12 was placed (total 105.00).", "createdAt": "..." } }
```

The server pings every 30 seconds and closes connections that do not answer. After a reconnect the client calls `GET /api/notifications` to catch up on what it missed.

## Run and test

From the `project/` folder:

```
npm install
npm test -w services/notification-service      # needs no Docker
npm run dev:notification                       # starts on http://localhost:3005
```

## Configuration (environment variables)

| Variable       | Default                              |
| -------------- | ------------------------------------ |
| `PORT`         | `3005`                               |
| `DB_PATH`      | `./data/notifications.sqlite`        |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672`  |
