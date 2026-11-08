# Tests

Every service and the web client have their own automated tests in their own `tests/` folder. They need no running system:

```
npm test            # all of them, from the project/ folder
```

## End-to-end test

`e2e.mjs` checks the **running** system through the gateway, like a real client: register, log in, search, cart, order, live WebSocket notifications, cancel (stock comes back), admin ships and delivers, and the security rules (401, 403, 404 for internal paths).

```
npm run dev:all     # or: docker compose up --build   (in another terminal)
npm run e2e
```

It needs RabbitMQ running, because the cart is emptied, stock is restored and notifications are sent by events.
