import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { BooksPage } from "./pages/BooksPage";
import { CartPage } from "./pages/CartPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OrdersPage } from "./pages/OrdersPage";
import type { AppNotification, User } from "./types";
import { useLiveNotifications } from "./useLiveNotifications";

type Page = "books" | "cart" | "orders" | "notifications";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(getToken() !== null);
  const [page, setPage] = useState<Page>("books");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  // Pages reload their data when this number changes (a live event means something changed).
  const [version, setVersion] = useState(0);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setNotifications([]);
    setPage("books");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // After a page refresh, the saved token is used to get the user back.
  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(logout).finally(() => setChecking(false));
  }, [logout]);

  const connected = useLiveNotifications(user ? getToken() : null, {
    onNotification: (notification) => {
      setNotifications((current) => [notification, ...current]);
      setToasts((current) => [...current, notification]);
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== notification.id)), 6000);
      setVersion((v) => v + 1);
    },
    // After (re)connecting: catch up on notifications that arrived while the connection was down.
    onResync: () => {
      api.notifications().then(setNotifications).catch(() => {});
      setVersion((v) => v + 1);
    },
  });

  if (checking) return <p className="muted center">Loading…</p>;
  if (!user) return <AuthPage onLoggedIn={setUser} />;

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <>
      <header>
        <strong className="brand">📚 Bookstore</strong>
        <nav>
          <button className={page === "books" ? "active" : ""} onClick={() => setPage("books")}>Books</button>
          <button className={page === "cart" ? "active" : ""} onClick={() => setPage("cart")}>Cart</button>
          <button className={page === "orders" ? "active" : ""} onClick={() => setPage("orders")}>Orders</button>
          <button className={page === "notifications" ? "active" : ""} onClick={() => setPage("notifications")}>
            Notifications{unread > 0 && <span className="count">{unread}</span>}
          </button>
        </nav>
        <div className="row">
          <span className={`live ${connected ? "on" : "off"}`} title="Live updates">{connected ? "● live" : "○ offline"}</span>
          <span>{user.name} ({user.role.toLowerCase()})</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main>
        {page === "books" && <BooksPage user={user} version={version} />}
        {page === "cart" && <CartPage version={version} onOrdered={() => setPage("orders")} />}
        {page === "orders" && <OrdersPage user={user} version={version} />}
        {page === "notifications" && (
          <NotificationsPage
            notifications={notifications}
            onMarkedRead={(id) => setNotifications((current) => current.map((n) => (n.id === id ? { ...n, isRead: true } : n)))}
          />
        )}
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">🔔 {t.message}</div>
        ))}
      </div>
    </>
  );
}
