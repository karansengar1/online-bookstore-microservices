import type { AppNotification, Book, BookPage, Cart, Order, User } from "./types";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** An error answer from the gateway, with the HTTP status and the message from the service. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

let token: string | null = localStorage.getItem("token");
let onUnauthorized: () => void = () => {};

export const getToken = () => token;

export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem("token", value);
  else localStorage.removeItem("token");
}

/** Called when the gateway says 401 for a logged-in user (for example the token expired). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the gateway running?");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string; details?: Record<string, string[]> } | null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  }
  return data as T;
}

/** Turns any error into a text for the user, including the field errors of a rejected form. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details) {
      const fields = Object.entries(err.details).map(([field, problems]) => `${field}: ${problems.join(", ")}`);
      if (fields.length > 0) return `${err.message} (${fields.join("; ")})`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

export const api = {
  register: (name: string, email: string, password: string) => request<User>("POST", "/api/auth/register", { name, email, password }),
  login: async (email: string, password: string) => (await request<{ token: string }>("POST", "/api/auth/login", { email, password })).token,
  me: () => request<User>("GET", "/api/users/me"),

  books: (q: string, page: number) => request<BookPage>("GET", `/api/books?q=${encodeURIComponent(q)}&page=${page}&pageSize=8`),
  createBook: (book: Omit<Book, "id" | "description">) => request<Book>("POST", "/api/books", book),
  deleteBook: (id: string) => request<void>("DELETE", `/api/books/${id}`),

  cart: () => request<Cart>("GET", "/api/cart"),
  addToCart: (bookId: string, quantity: number) => request("POST", "/api/cart/items", { bookId, quantity }),
  setQuantity: (bookId: string, quantity: number) => request("PATCH", `/api/cart/items/${bookId}`, { quantity }),
  removeFromCart: (bookId: string) => request<void>("DELETE", `/api/cart/items/${bookId}`),

  placeOrder: () => request<Order>("POST", "/api/orders"),
  orders: () => request<Order[]>("GET", "/api/orders"),
  cancelOrder: (id: string) => request<Order>("POST", `/api/orders/${id}/cancel`),
  setOrderStatus: (id: string, status: "SHIPPED" | "DELIVERED") => request<Order>("PATCH", `/api/orders/${id}/status`, { status }),

  notifications: () => request<AppNotification[]>("GET", "/api/notifications"),
  markRead: (id: string) => request("PATCH", `/api/notifications/${id}/read`),
};
