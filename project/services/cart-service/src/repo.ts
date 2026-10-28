import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

export interface CartItem {
  bookId: string;
  quantity: number;
}

/**
 * All SQL for carts lives here. The cart only stores book ids and quantities,
 * never titles or prices: those belong to the Catalog service.
 */
export function createRepo(db: Db) {
  const findCart = db.prepare("SELECT id FROM carts WHERE user_id = ?");
  const touchCart = db.prepare("UPDATE carts SET updated_at = ? WHERE id = ?");

  const setQuantityTx = db.transaction((userId: string, bookId: string, quantity: number) => {
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO carts (id, user_id, updated_at) VALUES (?, ?, ?)").run(randomUUID(), userId, now);
    const cart = findCart.get(userId) as { id: string };
    db.prepare(
      `INSERT INTO cart_items (id, cart_id, book_id, quantity) VALUES (?, ?, ?, ?)
       ON CONFLICT (cart_id, book_id) DO UPDATE SET quantity = excluded.quantity`,
    ).run(randomUUID(), cart.id, bookId, quantity);
    touchCart.run(now, cart.id);
  });

  return {
    getItems(userId: string): CartItem[] {
      const cart = findCart.get(userId) as { id: string } | undefined;
      if (!cart) return [];
      return db
        .prepare("SELECT book_id AS bookId, quantity FROM cart_items WHERE cart_id = ? ORDER BY rowid")
        .all(cart.id) as CartItem[];
    },

    getQuantity(userId: string, bookId: string): number {
      const row = db
        .prepare(
          `SELECT ci.quantity AS quantity FROM cart_items ci
           JOIN carts c ON c.id = ci.cart_id
           WHERE c.user_id = ? AND ci.book_id = ?`,
        )
        .get(userId, bookId) as { quantity: number } | undefined;
      return row?.quantity ?? 0;
    },

    /** Sets the quantity of one book (adds the line if it is new). */
    setQuantity(userId: string, bookId: string, quantity: number): void {
      setQuantityTx(userId, bookId, quantity);
    },

    removeItem(userId: string, bookId: string): boolean {
      const result = db
        .prepare(
          `DELETE FROM cart_items WHERE book_id = ?
           AND cart_id = (SELECT id FROM carts WHERE user_id = ?)`,
        )
        .run(bookId, userId);
      return result.changes > 0;
    },

    /** Empties the cart. Also used later when an "order placed" event arrives. */
    clear(userId: string): void {
      db.prepare("DELETE FROM cart_items WHERE cart_id = (SELECT id FROM carts WHERE user_id = ?)").run(userId);
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
