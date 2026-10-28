import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { createProxyMiddleware } from "http-proxy-middleware";

export interface Route {
  /** Requests whose path starts with this prefix go to `target`. */
  prefix: string;
  target: string;
}

export interface GatewayConfig {
  jwtSecret: string;
  corsOrigin: string;
  routes: Route[];
}

/** Endpoints that work without a token. Everything else under /api needs a valid JWT. */
function isPublic(req: Request): boolean {
  if (req.method === "POST" && (req.path === "/api/auth/register" || req.path === "/api/auth/login")) {
    return true;
  }
  if (req.method === "GET" && (req.path === "/api/books" || req.path.startsWith("/api/books/"))) {
    return true;
  }
  return false;
}

export function createGateway(config: GatewayConfig) {
  const app = express();

  // NOTE: no express.json() here. The gateway must not consume request bodies,
  // otherwise the proxy would have nothing left to forward.

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "gateway" });
  });

  // Internal endpoints (service-to-service) are never reachable from outside.
  app.use("/internal", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // CORS, so the React client on another port may call the gateway.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Authentication: verify the JWT once here and pass the identity to the services in headers.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }

    // Never trust identity headers that came from the outside.
    delete req.headers["x-user-id"];
    delete req.headers["x-user-role"];

    if (isPublic(req)) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    // Browsers cannot set headers on a WebSocket, so that one route may use ?access_token=
    if (!token && req.path === "/api/notifications/ws" && typeof req.query.access_token === "string") {
      token = req.query.access_token;
    }
    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return;
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
      if (typeof payload === "string" || !payload.sub) {
        throw new Error("Unexpected token payload");
      }
      req.headers["x-user-id"] = payload.sub;
      req.headers["x-user-role"] = String(payload["role"] ?? "CUSTOMER");
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  // Routing: one proxy per prefix. They are mounted at the root so the full path is forwarded unchanged.
  for (const route of config.routes) {
    app.use(
      createProxyMiddleware({
        target: route.target,
        changeOrigin: true,
        pathFilter: route.prefix,
        on: {
          error: (err, _req, res) => {
            console.error(`proxy error for ${route.prefix}:`, err.message);
            if ("writeHead" in res) {
              if (!res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" });
              }
              res.end(JSON.stringify({ error: "Service unavailable" }));
            } else {
              res.end();
            }
          },
        },
      }),
    );
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
