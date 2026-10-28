export interface CatalogBook {
  id: string;
  title: string;
  author: string;
  priceCents: number;
  stock: number;
}

/** The three things that can happen when we ask the Catalog service about a book. */
export type CatalogLookup =
  | { status: "ok"; book: CatalogBook }
  | { status: "not_found" }
  | { status: "unavailable" };

export interface CatalogClient {
  getBook(bookId: string): Promise<CatalogLookup>;
}

/**
 * Calls the Catalog service over REST. Every call has a timeout, so a slow or dead
 * Catalog service can never make the Cart service hang.
 */
export function createCatalogClient(baseUrl: string, timeoutMs = 3000): CatalogClient {
  return {
    async getBook(bookId: string): Promise<CatalogLookup> {
      try {
        const res = await fetch(`${baseUrl}/internal/books/${encodeURIComponent(bookId)}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 404) return { status: "not_found" };
        if (!res.ok) return { status: "unavailable" };
        return { status: "ok", book: (await res.json()) as CatalogBook };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
