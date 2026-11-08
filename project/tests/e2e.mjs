// End-to-end test: runs against the RUNNING system (npm run dev:all, or docker compose up).
//   npm run e2e
// It uses the same public API as the web client and checks the whole chain: gateway, all five
// services and RabbitMQ.

const BASE = process.env.API_URL ?? "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/, "ws");
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@bookstore.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "Admin12345",
};

let failures = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Repeats `fn` until it returns something truthy, or gives up after the timeout. */
async function waitFor(fn, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

async function login(email, password) {
  const res = await call("POST", "/api/auth/login", { body: { email, password } });
  return res.body?.token;
}

/** Opens the live connection and collects every notification that arrives. */
async function openLiveConnection(token) {
  const received = [];
  const ws = new WebSocket(`${WS_BASE}/api/notifications/ws?access_token=${encodeURIComponent(token)}`);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "notification") received.push(message.data);
  });
  const opened = await waitFor(() => (ws.readyState === WebSocket.OPEN ? true : null), 5000);
  return { ws, received, opened: Boolean(opened) };
}

async function main() {
  console.log(`End-to-end test against ${BASE}\n`);

  console.log("Gateway and security");
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) {
    console.log("  ✗ The gateway does not answer. Start the system first (npm run dev:all or docker compose up).");
    process.exit(1);
  }
  check("gateway is healthy", true);
  check("a cart request without a token gets 401", (await call("GET", "/api/cart")).status === 401);
  check("internal endpoints are not reachable from outside", (await call("GET", "/internal/books/x")).status === 404);

  console.log("\nCustomer: register and log in");
  const email = `e2e-${Date.now()}@example.com`;
  const registered = await call("POST", "/api/auth/register", { body: { name: "E2E Tester", email, password: "Password123" } });
  check("registration works", registered.status === 201 && registered.body?.role === "CUSTOMER");
  const token = await login(email, "Password123");
  check("login returns a token", Boolean(token));

  console.log("\nCatalogue");
  const found = await call("GET", "/api/books?q=clean");
  const book = found.body?.items?.[0];
  check("search finds a book", Boolean(book), "(is the catalogue seeded?)");
  if (!book) process.exit(1);
  const stockOf = async () => (await call("GET", `/api/books/${book.id}`)).body.stock;
  const stockBefore = await stockOf();
  check("the book has stock", stockBefore > 0);

  console.log("\nPlace an order (cart -> order -> catalog, then events)");
  const live = await openLiveConnection(token);
  check("live WebSocket connection opens", live.opened);

  const added = await call("POST", "/api/cart/items", { token, body: { bookId: book.id, quantity: 1 } });
  check("book is added to the cart", added.status === 201);
  const order = await call("POST", "/api/orders", { token });
  check("order is created with status PLACED", order.status === 201 && order.body?.status === "PLACED");
  const orderId = order.body?.id;

  check("a live notification 'order.placed' arrives over WebSocket", Boolean(await waitFor(() => live.received.find((n) => n.kind === "order.placed"))));
  check("the cart is emptied by the order.placed event", Boolean(await waitFor(async () => (await call("GET", "/api/cart", { token })).body.items.length === 0)));
  check("the stock went down by one", (await stockOf()) === stockBefore - 1);
  const stored = await call("GET", "/api/notifications", { token });
  check("the notification is stored and can be listed", stored.body?.some((n) => n.kind === "order.placed") === true);

  console.log("\nCancel the order");
  const cancelled = await call("POST", `/api/orders/${orderId}/cancel`, { token });
  check("order is cancelled", cancelled.body?.status === "CANCELLED");
  check("the stock is given back by the order.cancelled event", Boolean(await waitFor(async () => (await stockOf()) === stockBefore)));
  check("a live notification 'order.cancelled' arrives", Boolean(await waitFor(() => live.received.find((n) => n.kind === "order.cancelled"))));

  console.log("\nAdmin ships and delivers a second order");
  await call("POST", "/api/cart/items", { token, body: { bookId: book.id, quantity: 1 } });
  const second = await call("POST", "/api/orders", { token });
  const secondId = second.body?.id;
  check("a customer cannot ship an order", (await call("PATCH", `/api/orders/${secondId}/status`, { token, body: { status: "SHIPPED" } })).status === 403);

  const adminToken = await login(ADMIN.email, ADMIN.password);
  check("admin can log in", Boolean(adminToken));
  const shipped = await call("PATCH", `/api/orders/${secondId}/status`, { token: adminToken, body: { status: "SHIPPED" } });
  check("admin marks the order shipped", shipped.body?.status === "SHIPPED");
  const skipped = await call("PATCH", `/api/orders/${secondId}/status`, { token: adminToken, body: { status: "SHIPPED" } });
  check("shipping twice is refused with 409", skipped.status === 409);
  const delivered = await call("PATCH", `/api/orders/${secondId}/status`, { token: adminToken, body: { status: "DELIVERED" } });
  check("admin marks the order delivered", delivered.body?.status === "DELIVERED");
  check("the customer is notified live about shipping", Boolean(await waitFor(() => live.received.find((n) => n.kind === "order.shipped"))));
  check("the customer is notified live about delivery", Boolean(await waitFor(() => live.received.find((n) => n.kind === "order.delivered"))));
  check("the customer sees only their own orders", (await call("GET", "/api/orders", { token })).body.every((o) => o.userId === registered.body.id));

  live.ws.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nThe test stopped with an error:", err);
  process.exit(1);
});
