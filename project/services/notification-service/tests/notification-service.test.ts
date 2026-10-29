import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db.js";
import { handleMessage } from "../src/handlers.js";
import { createHub, type Hub } from "../src/hub.js";
import { attachWebSocket } from "../src/ws-server.js";

const event = (eventId: string, type: string, userId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ eventId, type, occurredAt: new Date().toISOString(), data: { orderId: "abcdef1234567890", userId, ...extra } });

/** A hub that only records what would have been pushed. */
function recordingHub() {
  const sent: { userId: string; payload: unknown }[] = [];
  const hub: Hub = {
    add() {},
    send(userId, payload) {
      sent.push({ userId, payload });
      return 0;
    },
    connectionCount: () => 0,
    close() {},
  };
  return { hub, sent };
}

describe("event handler", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("stores a notification for each order event and pushes it live", () => {
    const { hub, sent } = recordingHub();
    expect(handleMessage(db, hub, event("e1", "order.placed", "anna", { totalCents: 10500 }))).toBe("processed");
    handleMessage(db, hub, event("e2", "order.shipped", "anna"));
    handleMessage(db, hub, event("e3", "order.delivered", "anna"));
    handleMessage(db, hub, event("e4", "order.cancelled", "anna"));
    const rows = db.prepare("SELECT kind, message FROM notifications ORDER BY rowid").all() as { kind: string; message: string }[];
    expect(rows.map((r) => r.kind)).toEqual(["order.placed", "order.shipped", "order.delivered", "order.cancelled"]);
    expect(rows[0]!.message).toBe("Order #abcdef12 was placed (total 105.00).");
    expect(rows[1]!.message).toContain("shipped");
    expect(sent).toHaveLength(4);
    expect(sent[0]).toMatchObject({ userId: "anna", payload: { type: "notification", data: { kind: "order.placed" } } });
  });

  it("neither stores nor pushes the same event twice", () => {
    const { hub, sent } = recordingHub();
    handleMessage(db, hub, event("e1", "order.placed", "anna"));
    expect(handleMessage(db, hub, event("e1", "order.placed", "anna"))).toBe("duplicate");
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 1 });
    expect(sent).toHaveLength(1);
  });

  it("ignores unknown event types and throws on garbage", () => {
    const { hub, sent } = recordingHub();
    expect(handleMessage(db, hub, event("e1", "inventory.low", "anna"))).toBe("ignored");
    expect(sent).toHaveLength(0);
    expect(() => handleMessage(db, hub, "not json")).toThrow();
    expect(() => handleMessage(db, hub, JSON.stringify({ eventId: "e2", type: "order.placed", occurredAt: "x", data: {} }))).toThrow();
  });
});

describe("REST", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    db = openDb(":memory:");
    app = createApp(db);
    const { hub } = recordingHub();
    handleMessage(db, hub, event("e1", "order.placed", "anna"));
    handleMessage(db, hub, event("e2", "order.shipped", "anna"));
    handleMessage(db, hub, event("e3", "order.placed", "ben"));
  });

  it("answers 401 without the identity header", async () => {
    expect((await request(app).get("/api/notifications")).status).toBe(401);
  });

  it("lists only the caller's notifications, newest first", async () => {
    const res = await request(app).get("/api/notifications").set("x-user-id", "anna");
    expect(res.status).toBe(200);
    expect(res.body.map((n: { kind: string }) => n.kind)).toEqual(["order.shipped", "order.placed"]);
    expect(res.body[0]).toMatchObject({ isRead: false });
  });

  it("marks one notification as read, but only for its owner", async () => {
    const [first] = (await request(app).get("/api/notifications").set("x-user-id", "anna")).body;
    expect((await request(app).patch(`/api/notifications/${first.id}/read`).set("x-user-id", "ben")).status).toBe(404);
    expect((await request(app).patch(`/api/notifications/${first.id}/read`).set("x-user-id", "anna")).status).toBe(200);
    const after = (await request(app).get("/api/notifications").set("x-user-id", "anna")).body;
    expect(after.find((n: { id: string }) => n.id === first.id).isRead).toBe(true);
  });
});

describe("WebSocket", () => {
  let db: Db;
  let hub: Hub;
  let server: http.Server;
  let url: string;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    db = openDb(":memory:");
    hub = createHub();
    server = http.createServer(createApp(db));
    attachWebSocket(server, hub);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/notifications/ws`;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.terminate();
    hub.close();
    server.close();
    server.closeAllConnections();
  });

  function connect(headers: Record<string, string> = {}) {
    const ws = new WebSocket(url, { headers });
    clients.push(ws);
    return ws;
  }

  function nextMessage(ws: WebSocket) {
    return new Promise<{ type: string; data?: { kind: string; message: string } }>((resolve, reject) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
      ws.once("error", reject);
    });
  }

  it("refuses a connection without the identity header", async () => {
    const ws = connect();
    await expect(
      new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      }),
    ).rejects.toThrow(/401/);
  });

  it("greets a new connection and pushes a new notification to that user only", async () => {
    const anna = connect({ "x-user-id": "anna" });
    const ben = connect({ "x-user-id": "ben" });
    expect(await nextMessage(anna)).toEqual({ type: "connected" });
    expect(await nextMessage(ben)).toEqual({ type: "connected" });
    const benMessages: unknown[] = [];
    ben.on("message", (raw) => benMessages.push(JSON.parse(raw.toString())));

    const pending = nextMessage(anna);
    handleMessage(db, hub, event("e1", "order.placed", "anna", { totalCents: 500 }));
    const message = await pending;
    expect(message.type).toBe("notification");
    expect(message.data).toMatchObject({ kind: "order.placed" });
    expect(message.data!.message).toContain("was placed");

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(benMessages).toEqual([]);
  });

  it("forgets a connection when it closes", async () => {
    const ws = connect({ "x-user-id": "anna" });
    await nextMessage(ws);
    expect(hub.connectionCount("anna")).toBe(1);
    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hub.connectionCount("anna")).toBe(0);
  });
});
