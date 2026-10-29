/** One line of a cart or an order: which book and how many. */
export interface Line {
  bookId: string;
  quantity: number;
}

export interface ReservedLine extends Line {
  title: string;
  priceCents: number;
}

export type CartResult = { status: "ok"; items: Line[] } | { status: "unavailable" };

export type ReserveResult =
  | { status: "ok"; items: ReservedLine[] }
  | { status: "insufficient_stock"; bookId: string }
  | { status: "not_found"; bookId: string }
  | { status: "unavailable" };

export interface CartClient {
  getCart(userId: string): Promise<CartResult>;
}

export interface CatalogClient {
  reserve(items: Line[]): Promise<ReserveResult>;
  /** Gives reserved stock back. Best effort: never throws. */
  release(items: Line[]): Promise<void>;
}

/** Asks the Cart service for the raw cart lines. Every call has a timeout. */
export function createCartClient(baseUrl: string, timeoutMs = 3000): CartClient {
  return {
    async getCart(userId) {
      try {
        const res = await fetch(`${baseUrl}/internal/carts/${encodeURIComponent(userId)}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { status: "unavailable" };
        const body = (await res.json()) as { items: Line[] };
        return { status: "ok", items: body.items };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

/** Reserves and releases stock in the Catalog service. */
export function createCatalogClient(baseUrl: string, timeoutMs = 3000): CatalogClient {
  const post = (path: string, items: Line[]) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  return {
    async reserve(items) {
      try {
        const res = await post("/internal/books/reserve", items);
        if (res.ok) {
          const body = (await res.json()) as { items: ReservedLine[] };
          return { status: "ok", items: body.items };
        }
        if (res.status === 409 || res.status === 404) {
          const body = (await res.json()) as { bookId: string };
          return { status: res.status === 409 ? "insufficient_stock" : "not_found", bookId: body.bookId };
        }
        return { status: "unavailable" };
      } catch {
        return { status: "unavailable" };
      }
    },

    async release(items) {
      try {
        await post("/internal/books/release", items);
      } catch (err) {
        console.error("Could not release stock:", err instanceof Error ? err.message : err);
      }
    },
  };
}
