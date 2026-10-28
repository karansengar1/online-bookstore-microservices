import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { seedAdmin } from "../src/seed.js";

const SECRET = "test-secret";

async function makeApp() {
  const db = openDb(":memory:");
  await seedAdmin(db, "admin@test.local", "AdminPass123");
  return createApp(db, { jwtSecret: SECRET, jwtExpiresInSeconds: 60 });
}

const newUser = { email: "Anna@Example.com", name: "Anna", password: "Password123" };

describe("user-service", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    app = await makeApp();
  });

  it("registers a customer and never returns the password hash", async () => {
    const res = await request(app).post("/api/auth/register").send(newUser);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "anna@example.com", name: "Anna", role: "CUSTOMER" });
    expect(res.body.password_hash).toBeUndefined();
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app).post("/api/auth/register").send(newUser);
    const res = await request(app).post("/api/auth/register").send(newUser);
    expect(res.status).toBe(409);
  });

  it("rejects a short password with 400", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...newUser, password: "short" });
    expect(res.status).toBe(400);
  });

  it("logs in and returns a JWT with the user id and role", async () => {
    const reg = await request(app).post("/api/auth/register").send(newUser);
    const res = await request(app).post("/api/auth/login").send({ email: newUser.email, password: newUser.password });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, SECRET) as JwtPayload;
    expect(payload.sub).toBe(reg.body.id);
    expect(payload.role).toBe("CUSTOMER");
  });

  it("rejects a wrong password and an unknown email with the same 401", async () => {
    await request(app).post("/api/auth/register").send(newUser);
    const wrong = await request(app).post("/api/auth/login").send({ email: newUser.email, password: "WrongPass123" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "Password123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("returns the own profile on /api/users/me", async () => {
    const reg = await request(app).post("/api/auth/register").send(newUser);
    const res = await request(app).get("/api/users/me").set("x-user-id", reg.body.id);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("anna@example.com");
  });

  it("answers 401 on /api/users/me without the identity header", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
  });

  it("lists users only for admins", async () => {
    const asCustomer = await request(app).get("/api/users").set("x-user-role", "CUSTOMER");
    expect(asCustomer.status).toBe(403);
    const asAdmin = await request(app).get("/api/users").set("x-user-role", "ADMIN");
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.length).toBeGreaterThanOrEqual(1);
  });

  it("answers 400 for malformed JSON", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
  });
});
