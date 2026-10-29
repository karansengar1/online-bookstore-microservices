import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { Hub } from "./hub.js";

export const WS_PATH = "/api/notifications/ws";

/**
 * Accepts WebSocket connections on /api/notifications/ws. The gateway has already checked the
 * token and put the user's id into the X-User-Id header, so a connection without it is refused.
 */
export function attachWebSocket(server: Server, hub: Hub): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    const userId = req.headers["x-user-id"];
    if (typeof userId !== "string" || userId === "") {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.add(userId, ws);
      ws.send(JSON.stringify({ type: "connected" })); // tells the client that live updates are on
    });
  });

  return wss;
}
