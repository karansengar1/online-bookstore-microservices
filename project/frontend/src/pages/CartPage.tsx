import { useCallback, useEffect, useState } from "react";
import { api, messageOf } from "../api";
import type { Cart } from "../types";
import { formatMoney } from "../utils";

export function CartPage({ version, onOrdered }: { version: number; onOrdered: () => void }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.cart().then(setCart).catch((err) => setError(messageOf(err)));
  }, []);
  useEffect(load, [load, version]);

  /** Runs one cart action, shows a possible error, and reloads the cart. */
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError("");
    try {
      await action();
      after?.();
    } catch (err) {
      setError(messageOf(err));
    }
    load();
  }

  return (
    <section>
      <h2>Your cart</h2>
      {error && <p className="error">{error}</p>}
      {cart && !cart.catalogAvailable && <p className="error">The catalogue is not reachable, so titles and prices cannot be shown.</p>}
      {cart && cart.items.length === 0 && <p className="muted">Your cart is empty.</p>}

      {cart?.items.map((line) => (
        <div key={line.bookId} className="card line">
          <div>
            <strong>{line.book?.title ?? "Unknown book"}</strong>
            <p className="muted">{line.book?.author}</p>
          </div>
          <div className="row">
            <button disabled={line.quantity <= 1} onClick={() => run(() => api.setQuantity(line.bookId, line.quantity - 1))}>−</button>
            <span>{line.quantity}</span>
            <button onClick={() => run(() => api.setQuantity(line.bookId, line.quantity + 1))}>+</button>
            <span className="price">{line.lineTotalCents === null ? "–" : formatMoney(line.lineTotalCents)}</span>
            <button className="danger" onClick={() => run(() => api.removeFromCart(line.bookId))}>Remove</button>
          </div>
        </div>
      ))}

      {cart && cart.items.length > 0 && (
        <div className="row total">
          <strong>Total: {cart.totalCents === null ? "–" : formatMoney(cart.totalCents)}</strong>
          <button disabled={!cart.catalogAvailable} onClick={() => run(() => api.placeOrder(), onOrdered)}>Place order</button>
        </div>
      )}
    </section>
  );
}
