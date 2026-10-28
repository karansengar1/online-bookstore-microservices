# User Service

Registration, login, password hashing and JWT issuing. Owns the `users` data. Port **3001**.

**Status:** implemented and tested. See the [API reference](../../docs/05-api-reference.md) for the design.

## Endpoints

| Method | Path                 | Access   | Description                                   |
| ------ | -------------------- | -------- | --------------------------------------------- |
| POST   | `/api/auth/register` | Public   | Create a customer account                     |
| POST   | `/api/auth/login`    | Public   | Returns `{ token }` (JWT, valid for 1 hour)   |
| GET    | `/api/users/me`      | Customer | Own profile (identity comes from the gateway) |
| GET    | `/api/users`         | Admin    | List users                                    |
| GET    | `/health`            | Internal | Health check                                  |

## Run and test

From the `project/` folder:

```
npm install
npm run dev:user      # starts on http://localhost:3001
npm test -w services/user-service
```

## Configuration (environment variables)

| Variable         | Default                   | Meaning                                |
| ---------------- | ------------------------- | -------------------------------------- |
| `PORT`           | `3001`                    | Port to listen on                      |
| `DB_PATH`        | `./data/users.sqlite`     | SQLite file                            |
| `JWT_SECRET`     | `dev-secret-change-me`    | Signing key (must match the gateway)   |
| `ADMIN_EMAIL`    | `admin@bookstore.local`   | Admin account created on first start   |
| `ADMIN_PASSWORD` | `Admin12345`              | Password of that admin (dev only)      |
