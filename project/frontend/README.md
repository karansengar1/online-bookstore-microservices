# Web client

React + TypeScript + Vite single-page app for customers and admins. It talks only to the API gateway. Port **5173**.

**Status:** implemented. See the [overview](../docs/01-overview.md) for what each role can do.

## Pages

| Page          | Customer                                        | Admin                                   |
| ------------- | ----------------------------------------------- | --------------------------------------- |
| Log in / register | Create an account, log in                   | Log in (`admin@bookstore.local`)        |
| Books         | Search, add to cart                             | Also add and delete books               |
| Cart          | Change quantities, remove, **place order**      |                                         |
| Orders        | Own orders, cancel while `PLACED`               | All orders, mark shipped / delivered    |
| Notifications | List, mark as read, **live toast** on new ones  |                                         |

## Live updates

After login the app opens a WebSocket to `ws://localhost:3000/api/notifications/ws?access_token=<JWT>`. When the Notification service pushes a message, a toast appears and the open page reloads its data, so an order's status changes without refreshing. If the connection drops, the app reconnects after 1 s, 2 s, 4 s ... (at most 30 s) and then loads the notifications it missed.

## Run and test

From the `project/` folder:

```
npm install
npm run dev:frontend      # http://localhost:5173 (the gateway must be running)
npm test -w frontend
```

The API address can be changed with the `VITE_API_URL` environment variable (default `http://localhost:3000`).
