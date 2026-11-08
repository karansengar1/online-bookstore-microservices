import { useEffect, useRef, useState } from "react";
import { API_URL } from "./api";
import type { AppNotification } from "./types";
import { reconnectDelay, toWsUrl } from "./utils";

interface Handlers {
  onNotification: (notification: AppNotification) => void;
  /** Called after every (re)connect: load what was missed while the connection was down. */
  onResync: () => void;
}

/**
 * Keeps a WebSocket open to the Notification service (through the gateway) while the user is logged in.
 * If the connection drops, it reconnects after a growing delay, and asks the app to resynchronise.
 * Returns true while the live connection is up.
 */
export function useLiveNotifications(token: string | null, handlers: Handlers): boolean {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | undefined;
    let timer: number | undefined;
    let attempt = 0;
    let closedByUs = false;

    const connect = () => {
      socket = new WebSocket(toWsUrl(API_URL, token));
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; data?: Omit<AppNotification, "isRead"> };
        if (message.type === "connected") {
          attempt = 0;
          setConnected(true);
          handlersRef.current.onResync();
        } else if (message.type === "notification" && message.data) {
          handlersRef.current.onNotification({ ...message.data, isRead: false });
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closedByUs) timer = window.setTimeout(connect, reconnectDelay(attempt++));
      };
    };

    connect();
    return () => {
      closedByUs = true;
      window.clearTimeout(timer);
      socket?.close();
      setConnected(false);
    };
  }, [token]);

  return connected;
}
