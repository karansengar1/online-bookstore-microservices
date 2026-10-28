import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { seedAdmin } from "./seed.js";

const port = Number(process.env.PORT ?? 3001);
const db = openDb(process.env.DB_PATH ?? "./data/users.sqlite");

const jwtSecret = process.env.JWT_SECRET ?? "dev-secret-change-me";
if (jwtSecret === "dev-secret-change-me") {
  console.warn("WARNING: using the default JWT secret. Set JWT_SECRET outside of local development.");
}

await seedAdmin(
  db,
  process.env.ADMIN_EMAIL ?? "admin@bookstore.local",
  process.env.ADMIN_PASSWORD ?? "Admin12345",
);

createApp(db, { jwtSecret, jwtExpiresInSeconds: 3600 }).listen(port, () => {
  console.log(`user-service listening on http://localhost:${port}`);
});
