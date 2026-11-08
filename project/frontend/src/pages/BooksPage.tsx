import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, messageOf } from "../api";
import type { BookPage, User } from "../types";
import { formatMoney } from "../utils";

/** Browse and search the catalogue. Admins can also add and delete books. */
export function BooksPage({ user, version }: { user: User; version: number }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BookPage | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [newBook, setNewBook] = useState({ title: "", author: "", isbn: "", price: "", stock: "" });

  const load = useCallback(() => {
    api.books(search, page).then(setData).catch((err) => setError(messageOf(err)));
  }, [search, page]);

  // Also reloads when `version` changes, because a notification may mean that stock has changed.
  useEffect(load, [load, version]);

  async function addToCart(bookId: string, title: string) {
    setError("");
    setInfo("");
    try {
      await api.addToCart(bookId, 1);
      setInfo(`"${title}" was added to your cart.`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function createBook(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.createBook({
        title: newBook.title,
        author: newBook.author,
        isbn: newBook.isbn,
        priceCents: Math.round(Number(newBook.price) * 100),
        stock: Number(newBook.stock),
      });
      setNewBook({ title: "", author: "", isbn: "", price: "", stock: "" });
      load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function deleteBook(id: string) {
    setError("");
    try {
      await api.deleteBook(id);
      load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section>
      <h2>Books</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(query); }}>
        <input placeholder="Search by title or author" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button>Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {info && <p className="success">{info}</p>}

      <div className="grid">
        {data?.items.map((book) => (
          <article key={book.id} className="card">
            <h3>{book.title}</h3>
            <p className="muted">{book.author}</p>
            <p>{book.description}</p>
            <p>
              <strong>{formatMoney(book.priceCents)}</strong> · {book.stock > 0 ? `${book.stock} in stock` : "out of stock"}
            </p>
            <div className="row">
              <button disabled={book.stock === 0} onClick={() => addToCart(book.id, book.title)}>Add to cart</button>
              {user.role === "ADMIN" && <button className="danger" onClick={() => deleteBook(book.id)}>Delete</button>}
            </div>
          </article>
        ))}
      </div>
      {data && data.items.length === 0 && <p className="muted">No books found.</p>}

      <div className="row">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {lastPage}</span>
        <button disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {user.role === "ADMIN" && (
        <form className="card" onSubmit={createBook}>
          <h3>Add a book (admin)</h3>
          <input placeholder="Title" value={newBook.title} onChange={(e) => setNewBook({ ...newBook, title: e.target.value })} required />
          <input placeholder="Author" value={newBook.author} onChange={(e) => setNewBook({ ...newBook, author: e.target.value })} required />
          <input placeholder="ISBN" value={newBook.isbn} onChange={(e) => setNewBook({ ...newBook, isbn: e.target.value })} required />
          <input placeholder="Price, for example 39.90" type="number" step="0.01" min="0" value={newBook.price} onChange={(e) => setNewBook({ ...newBook, price: e.target.value })} required />
          <input placeholder="Stock" type="number" min="0" value={newBook.stock} onChange={(e) => setNewBook({ ...newBook, stock: e.target.value })} required />
          <button>Add book</button>
        </form>
      )}
    </section>
  );
}
