import { useCallback, useEffect, useState } from "react";
import { api, messageOf } from "../api";
import type { Order, User } from "../types";
import { formatMoney } from "../utils";

/** Customers see their own orders, admins see all of them and can ship and deliver. */
export function OrdersPage({ user, version }: { user: User; version: number }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.orders().then(setOrders).catch((err) => setError(messageOf(err)));
  }, []);
  // `version` changes when a live notification arrives, so statuses update without reloading the page.
  useEffect(load, [load, version]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    }
    load();
  }

  return (
    <section>
      <h2>{user.role === "ADMIN" ? "All orders" : "Your orders"}</h2>
      {error && <p className="error">{error}</p>}
      {orders && orders.length === 0 && <p className="muted">No orders yet.</p>}

      {orders?.map((order) => (
        <article key={order.id} className="card">
          <div className="row between">
            <strong>Order #{order.id.slice(0, 8)}</strong>
            <span className={`badge ${order.status.toLowerCase()}`}>{order.status}</span>
          </div>
          <p className="muted">{new Date(order.createdAt).toLocaleString()}</p>
          <ul>
            {order.items.map((item) => (
              <li key={item.bookId}>
                {item.quantity} × {item.title} ({formatMoney(item.unitPriceCents)})
              </li>
            ))}
          </ul>
          <div className="row between">
            <strong>Total: {formatMoney(order.totalCents)}</strong>
            <div className="row">
              {order.status === "PLACED" && <button className="danger" onClick={() => run(() => api.cancelOrder(order.id))}>Cancel</button>}
              {user.role === "ADMIN" && order.status === "PLACED" && <button onClick={() => run(() => api.setOrderStatus(order.id, "SHIPPED"))}>Mark shipped</button>}
              {user.role === "ADMIN" && order.status === "SHIPPED" && <button onClick={() => run(() => api.setOrderStatus(order.id, "DELIVERED"))}>Mark delivered</button>}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
