import { createApp } from "./app.js";
import { createCatalogClient } from "./catalog-client.js";
import { openDb } from "./db.js";

const port = Number(process.env.PORT ?? 3003);
const db = openDb(process.env.DB_PATH ?? "./data/cart.sqlite");
const catalog = createCatalogClient(process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002");

createApp(db, catalog).listen(port, () => {
  console.log(`cart-service listening on http://localhost:${port}`);
});
