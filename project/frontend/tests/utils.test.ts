import { describe, expect, it } from "vitest";
import { formatMoney, reconnectDelay, toWsUrl } from "../src/utils";

describe("utils", () => {
  it("formats cents as money with two decimals", () => {
    expect(formatMoney(3990)).toBe("39.90");
    expect(formatMoney(5)).toBe("0.05");
    expect(formatMoney(0)).toBe("0.00");
  });

  it("doubles the reconnect delay each time, up to 30 seconds", () => {
    expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(reconnectDelay(10)).toBe(30_000);
    expect(reconnectDelay(100)).toBe(30_000);
  });

  it("builds the WebSocket address from the API address and encodes the token", () => {
    expect(toWsUrl("http://localhost:3000", "a b")).toBe("ws://localhost:3000/api/notifications/ws?access_token=a%20b");
    expect(toWsUrl("https://shop.example", "t")).toBe("wss://shop.example/api/notifications/ws?access_token=t");
  });
});
