import { WebSocket } from "ws";

/** Keeps track of the open WebSocket connections of each user and sends messages to them. */
export interface Hub {
  add(userId: string, socket: WebSocket): void;
  /** Sends a JSON message to every open connection of the user. Returns how many received it. */
  send(userId: string, payload: unknown): number;
  connectionCount(userId: string): number;
  close(): void;
}

/**
 * Heartbeat: every `heartbeatMs` the server pings all connections. A connection that did not
 * answer the previous ping with a pong is dead (for example the laptop went to sleep) and is closed.
 */
export function createHub(heartbeatMs = 30_000): Hub {
  const sockets = new Map<string, Set<WebSocket>>();
  const alive = new WeakSet<WebSocket>();

  const timer = setInterval(() => {
    for (const set of sockets.values()) {
      for (const socket of set) {
        if (!alive.has(socket)) {
          socket.terminate();
          continue;
        }
        alive.delete(socket);
        socket.ping();
      }
    }
  }, heartbeatMs);
  timer.unref();

  return {
    add(userId, socket) {
      let set = sockets.get(userId);
      if (!set) {
        set = new Set();
        sockets.set(userId, set);
      }
      const mine = set;
      mine.add(socket);
      alive.add(socket);
      socket.on("pong", () => alive.add(socket));
      socket.on("close", () => {
        mine.delete(socket);
        if (mine.size === 0) sockets.delete(userId);
      });
    },

    send(userId, payload) {
      const text = JSON.stringify(payload);
      let delivered = 0;
      for (const socket of sockets.get(userId) ?? []) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(text);
          delivered += 1;
        }
      }
      return delivered;
    },

    connectionCount(userId) {
      return sockets.get(userId)?.size ?? 0;
    },

    close() {
      clearInterval(timer);
      for (const set of sockets.values()) for (const socket of set) socket.close();
    },
  };
}
