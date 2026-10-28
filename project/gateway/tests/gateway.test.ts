import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createGateway } from "../src/app.js";

const SECRET = "test-secret";

let upstream: http.Server;
let upstreamUrl: string;
let app: ReturnType<typeof createGateway>;

beforeAll(async () => {
  // A tiny fake service that echoes what it received, so we can see what the gateway forwarded.
  upstream = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        path: req.url,
        userId: req.headers["x-user-id"] ?? null,
        role: req.headers["x-user-role"] ?? null,
      }),
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  app = createGateway({
    jwtSecret: SECRET,
    corsOrigin: "http://localhost:5173",
    routes: [
      { prefix: "/api/auth", target: upstreamUrl },
      { prefix: "/api/orders", target: upstreamUrl },
      { prefix: "/api/books", target: upstreamUrl },
      { prefix: "/api/cart", target: "http://127.0.0.1:1" }, // nothing listens here
    ],
  });
});

afterAll(() => {
  upstream.close();
});

const token = (role = "CUSTOMER") => jwt.sign({ role }, SECRET, { subject: "user-123", expiresIn: 60 });

describe("gateway", () => {
  it("answers its own health check", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("lets login through without a token and keeps the full path", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "x" });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/api/auth/login");
  });

  it("lets anyone read the book catalogue", async () => {
    const res = await request(app).get("/api/books");
    expect(res.status).toBe(200);
  });

  it("rejects a protected route without a token", async () => {
    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await request(app).get("/api/orders").set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with another secret", async () => {
    const bad = jwt.sign({ role: "ADMIN" }, "other-secret", { subject: "x", expiresIn: 60 });
    const res = await request(app).get("/api/orders").set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it("forwards the user id and role from a valid token", async () => {
    const res = await request(app).get("/api/orders").set("Authorization", `Bearer ${token("CUSTOMER")}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-123");
    expect(res.body.role).toBe("CUSTOMER");
  });

  it("overwrites identity headers sent by the client", async () => {
    const res = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${token("CUSTOMER")}`)
      .set("x-user-role", "ADMIN")
      .set("x-user-id", "someone-else");
    expect(res.body.role).toBe("CUSTOMER");
    expect(res.body.userId).toBe("user-123");
  });

  it("removes identity headers on public routes too", async () => {
    const res = await request(app).get("/api/books").set("x-user-role", "ADMIN");
    expect(res.body.role).toBeNull();
  });

  it("never exposes /internal paths", async () => {
    const res = await request(app).get("/internal/books/reserve");
    expect(res.status).toBe(404);
  });

  it("answers 503 when the target service is down", async () => {
    const res = await request(app).get("/api/cart").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(503);
  });

  it("answers CORS preflight requests", async () => {
    const res = await request(app).options("/api/orders").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
