import { createGateway, createUpgradeHandler, type GatewayConfig } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

const userService = process.env.USER_SERVICE_URL ?? "http://localhost:3001";
const catalogService = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002";
const cartService = process.env.CART_SERVICE_URL ?? "http://localhost:3003";
const orderService = process.env.ORDER_SERVICE_URL ?? "http://localhost:3004";
const notificationService = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3005";

const jwtSecret = process.env.JWT_SECRET ?? "dev-secret-change-me";
if (jwtSecret === "dev-secret-change-me") {
  console.warn("WARNING: using the default JWT secret. Set JWT_SECRET outside of local development.");
}

const config: GatewayConfig = {
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  routes: [
    { prefix: "/api/auth", target: userService },
    { prefix: "/api/users", target: userService },
    { prefix: "/api/books", target: catalogService },
    { prefix: "/api/cart", target: cartService },
    { prefix: "/api/orders", target: orderService },
    { prefix: "/api/notifications", target: notificationService },
  ],
};

const server = createGateway(config).listen(port, () => {
  console.log(`gateway listening on http://localhost:${port}`);
});

// WebSocket connections (live notifications) arrive as "upgrade" requests.
server.on("upgrade", createUpgradeHandler(config));
