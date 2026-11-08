/** 3990 -> "39.90". Money is always handled in cents and only formatted for display. */
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Waiting time before reconnecting: 1 s, 2 s, 4 s, 8 s ... but never more than 30 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

/** http://host:3000 -> ws://host:3000/api/notifications/ws?access_token=... (https -> wss). */
export function toWsUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/^http/, "ws")}/api/notifications/ws?access_token=${encodeURIComponent(token)}`;
}
