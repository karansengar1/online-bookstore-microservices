import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { seedBooks } from "./seed.js";

const port = Number(process.env.PORT ?? 3002);
const db = openDb(process.env.DB_PATH ?? "./data/catalog.sqlite");

if (process.env.SEED_BOOKS !== "false") {
  seedBooks(db);
}

createApp(db).listen(port, () => {
  console.log(`catalog-service listening on http://localhost:${port}`);
});
