import { useState, type FormEvent } from "react";
import { api, messageOf, setToken } from "../api";
import type { User } from "../types";

export function AuthPage({ onLoggedIn }: { onLoggedIn: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") await api.register(form.name, form.email, form.password);
      setToken(await api.login(form.email, form.password));
      onLoggedIn(await api.me());
    } catch (err) {
      setToken(null);
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <h1>Online Bookstore</h1>
      <form className="card" onSubmit={submit}>
        <h2>{mode === "login" ? "Log in" : "Create an account"}</h2>
        {mode === "register" && (
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
        )}
        <label>
          E-mail
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label>
          Password {mode === "register" && <small>(at least 8 characters)</small>}
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{mode === "login" ? "Log in" : "Register"}</button>
        <p className="muted">
          {mode === "login" ? "No account yet? " : "Already registered? "}
          <a href="#" onClick={(e) => { e.preventDefault(); setError(""); setMode(mode === "login" ? "register" : "login"); }}>
            {mode === "login" ? "Register" : "Log in"}
          </a>
        </p>
      </form>
    </div>
  );
}
