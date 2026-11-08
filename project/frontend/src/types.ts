export type Role = "CUSTOMER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string;
  priceCents: number;
  stock: number;
  description: string;
}

export interface BookPage {
  items: Book[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CartLine {
  bookId: string;
  quantity: number;
  /** null when the Catalog service cannot be reached or the book was deleted */
  book: { title: string; author: string; priceCents: number; stock: number } | null;
  lineTotalCents: number | null;
}

export interface Cart {
  items: CartLine[];
  totalCents: number | null;
  catalogAvailable: boolean;
}

export type OrderStatus = "PLACED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

export interface OrderItem {
  bookId: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface AppNotification {
  id: string;
  kind: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}
