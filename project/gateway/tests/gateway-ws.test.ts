import http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createGateway, createUpgradeHandler } from "../src/app.js";

const SECRET = "test-secret";

let upstream: http.Server;
let gateway: http.Server;
let gatewayUrl: string;
const clients: WebSocket[] = [];

beforeAll(async () => {
  // A fake Notification service: it tells every client which identity the gateway gave it.
  upstream = http.createServer();
  const wss = new WebSocketServer({ server: upstream });
  wss.on("connection", (socket, req) => {
    socket.send(JSON.stringify({ userId: req.headers["x-user-id"], role: req.headers["x-user-role"] }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const config = {
    jwtSecret: SECRET,
    corsOrigin: "http://localhost:5173",
    routes: [{ prefix: "/api/notifications", target: upstreamUrl }],
  };
  gateway = http.createServer(createGateway(config));
  gateway.on("upgrade", createUpgradeHandler(config));
  await new Promise<void>((resolve) => gateway.listen(0, resolve));
  gatewayUrl = `ws://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
});

afterAll(() => {
  for (const client of clients) client.terminate();
  gateway.close();
  upstream.close();
  gateway.closeAllConnections();
  upstream.closeAllConnections();
});

const token = (role = "CUSTOMER") => jwt.sign({ role }, SECRET, { subject: "user-123", expiresIn: 60 });

function open(path: string) {
  const ws = new WebSocket(`${gatewayUrl}${path}`);
  clients.push(ws);
  return ws;
}

const firstMessage = (ws: WebSocket) =>
  new Promise<{ userId: string; role: string }>((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    ws.once("error", reject);
  });

const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

describe("gateway WebSocket", () => {
  it("passes the connection to the service with the identity from the token", async () => {
    const ws = open(`/api/notifications/ws?access_token=${token("CUSTOMER")}`);
    expect(await firstMessage(ws)).toEqual({ userId: "user-123", role: "CUSTOMER" });
  });

  it("refuses a connection without a token", async () => {
    await expect(opened(open("/api/notifications/ws"))).rejects.toThrow(/401/);
  });

  it("refuses an invalid token", async () => {
    await expect(opened(open("/api/notifications/ws?access_token=garbage"))).rejects.toThrow(/401/);
  });

  it("refuses a token signed with another secret", async () => {
    const bad = jwt.sign({ role: "ADMIN" }, "other-secret", { subject: "x", expiresIn: 60 });
    await expect(opened(open(`/api/notifications/ws?access_token=${bad}`))).rejects.toThrow(/401/);
  });

  it("does not open WebSockets on other paths", async () => {
    await expect(opened(open(`/api/orders/ws?access_token=${token()}`))).rejects.toThrow();
  });
});
