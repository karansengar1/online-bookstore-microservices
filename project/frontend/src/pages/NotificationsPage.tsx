import { api } from "../api";
import type { AppNotification } from "../types";

export function NotificationsPage({
  notifications,
  onMarkedRead,
}: {
  notifications: AppNotification[];
  onMarkedRead: (id: string) => void;
}) {
  async function markRead(id: string) {
    try {
      await api.markRead(id);
      onMarkedRead(id);
    } catch {
      /* the next resync shows the real state */
    }
  }

  return (
    <section>
      <h2>Notifications</h2>
      {notifications.length === 0 && <p className="muted">Nothing yet. Place an order to see one appear live.</p>}
      {notifications.map((n) => (
        <article key={n.id} className={`card note ${n.isRead ? "" : "unread"}`}>
          <div>
            <p>{n.message}</p>
            <p className="muted">{new Date(n.createdAt).toLocaleString()}</p>
          </div>
          {!n.isRead && <button onClick={() => markRead(n.id)}>Mark as read</button>}
        </article>
      ))}
    </section>
  );
}
