import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCartClient, createCatalogClient } from "../src/clients.js";
import { openDb } from "../src/db.js";
import { createOutboxDispatcher, enqueueEvent, type EventPublisher } from "../src/outbox.js";

describe("outbox dispatcher", () => {
  function setup() {
    const db = openDb(":memory:");
    const sent: { key: string; payload: string }[] = [];
    const state = { failing: false };
    const publisher: EventPublisher = {
      async publish(key, payload) {
        if (state.failing) throw new Error("broker down");
        sent.push({ key, payload });
      },
    };
    return { db, sent, state, dispatcher: createOutboxDispatcher(db, publisher) };
  }

  it("publishes pending events in order and marks them as sent", async () => {
    const { db, sent, dispatcher } = setup();
    enqueueEvent(db, "order.placed", { n: 1 });
    enqueueEvent(db, "order.shipped", { n: 2 });
    expect(await dispatcher.flush()).toBe(2);
    expect(sent.map((s) => s.key)).toEqual(["order.placed", "order.shipped"]);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ type: "order.placed", data: { n: 1 } });
    expect(await dispatcher.flush()).toBe(0); // nothing is sent twice
    expect(sent).toHaveLength(2);
  });

  it("keeps events when the broker is down and sends them later", async () => {
    const { db, sent, state, dispatcher } = setup();
    enqueueEvent(db, "order.placed", { n: 1 });
    state.failing = true;
    expect(await dispatcher.flush()).toBe(0);
    expect(sent).toHaveLength(0);
    state.failing = false;
    expect(await dispatcher.flush()).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe("clients", () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/internal/carts/anna") {
        res.end(JSON.stringify({ userId: "anna", items: [{ bookId: "b1", quantity: 2 }] }));
      } else if (req.url === "/internal/books/reserve") {
        const bookId = (JSON.parse(body) as { items: { bookId: string }[] }).items[0]!.bookId;
        if (bookId === "ok") res.end(JSON.stringify({ items: [{ bookId, title: "T", priceCents: 100, quantity: 1 }] }));
        else if (bookId === "short") (res.statusCode = 409), res.end(JSON.stringify({ bookId }));
        else if (bookId === "gone") (res.statusCode = 404), res.end(JSON.stringify({ bookId }));
        else (res.statusCode = 500), res.end("{}");
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  it("cart client returns the lines, or unavailable", async () => {
    expect(await createCartClient(baseUrl).getCart("anna")).toEqual({ status: "ok", items: [{ bookId: "b1", quantity: 2 }] });
    expect(await createCartClient(baseUrl).getCart("other")).toEqual({ status: "unavailable" });
    expect(await createCartClient("http://127.0.0.1:1", 500).getCart("anna")).toEqual({ status: "unavailable" });
  });

  it("catalog client maps the answers to ok, insufficient_stock, not_found and unavailable", async () => {
    const catalog = createCatalogClient(baseUrl);
    expect(await catalog.reserve([{ bookId: "ok", quantity: 1 }])).toMatchObject({ status: "ok", items: [{ title: "T" }] });
    expect(await catalog.reserve([{ bookId: "short", quantity: 1 }])).toEqual({ status: "insufficient_stock", bookId: "short" });
    expect(await catalog.reserve([{ bookId: "gone", quantity: 1 }])).toEqual({ status: "not_found", bookId: "gone" });
    expect(await catalog.reserve([{ bookId: "boom", quantity: 1 }])).toEqual({ status: "unavailable" });
    expect(await createCatalogClient("http://127.0.0.1:1", 500).reserve([{ bookId: "ok", quantity: 1 }])).toEqual({ status: "unavailable" });
  });

  it("catalog release never throws, even when the service is down", async () => {
    await expect(createCatalogClient("http://127.0.0.1:1", 500).release([{ bookId: "x", quantity: 1 }])).resolves.toBeUndefined();
  });
});
