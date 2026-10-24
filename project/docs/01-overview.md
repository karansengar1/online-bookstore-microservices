# 01 Overview

## Purpose

The system lets customers buy books online and lets admins run the catalogue and fulfil orders. The main goal of the project is to show a clean split into five independent services with clear data ownership and two communication styles (REST and events).

## Functional requirements

| ID   | Requirement                                                              | Actor    |
| ---- | ------------------------------------------------------------------------ | -------- |
| F1   | Register and log in                                                      | Customer, Admin |
| F2   | Browse and search books                                                  | Anyone   |
| F3   | Add, edit and delete books, and set stock                                | Admin    |
| F4   | Add books to a cart, change quantities, remove items                     | Customer |
| F5   | Place an order from the cart                                             | Customer |
| F6   | View own orders; admins view all orders                                  | Customer, Admin |
| F7   | Cancel an order while it is still `PLACED`                               | Customer, Admin |
| F8   | Mark an order as shipped or delivered                                    | Admin    |
| F9   | Receive live notifications when an order is placed or changes status     | Customer |

## Non-functional requirements

| Quality         | Target                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| Independence    | Each service has its own code, database and container; no shared database               |
| Resilience      | A failing Notification Service must not stop customers from placing orders              |
| Security        | Passwords hashed; JWT checked at the gateway; admin endpoints restricted by role        |
| Simplicity      | Whole system starts with one command: `docker compose up`                               |
| Testability     | Each service has its own automated tests                                                |

## System context

| Element        | Role                                                         |
| -------------- | ------------------------------------------------------------ |
| Customer       | Uses the web client to browse, order and follow orders       |
| Admin          | Uses the same web client with extra pages for catalogue and orders |
| Bookstore system | The five services, gateway, broker and web client          |

There are no external systems. Payment and e-mail are out of scope; the Notification Service stores notifications and streams them to the browser instead of sending real e-mail.

## Services

| Service              | Responsibility                                                    | Owns data      |
| -------------------- | ----------------------------------------------------------------- | -------------- |
| User Service         | Registration, login, password hashing, issuing JWTs, user profile | `users`        |
| Catalog Service      | Books, search, stock reservation and release                      | `books`        |
| Cart Service         | One cart per customer, validates books against the catalogue      | `carts`, `cart_items` |
| Order Service        | Creates orders from carts, order lifecycle, publishes order events | `orders`, `order_items` |
| Notification Service | Consumes order events, stores notifications, pushes them live over SSE | `notifications` |

Why five: each one changes for a different reason and has its own data. The boundaries follow the business areas (identity, products, shopping, ordering, messaging), which is how bounded contexts are usually found.

## Use cases

| Use case          | Main flow                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Buy books         | Log in → browse catalogue → add to cart → place order → see live confirmation                           |
| Cancel an order   | Open own order → cancel while `PLACED` → stock is released → notification arrives                      |
| Manage catalogue  | Admin logs in → adds or edits a book → sets stock                                                       |
| Fulfil an order   | Admin opens an order → marks it shipped → marks it delivered → customer is notified at each step        |

## Technology

| Area               | Choice                                           |
| ------------------ | ------------------------------------------------ |
| Language           | TypeScript (backend and frontend)                |
| Runtime, framework | Node.js 20, Express                              |
| Validation         | zod                                              |
| Auth               | bcryptjs, jsonwebtoken (JWT)                     |
| Database           | SQLite (better-sqlite3), one file per service    |
| Messaging          | RabbitMQ (amqplib)                               |
| Gateway            | Express with http-proxy-middleware               |
| Real-time          | Server-Sent Events                               |
| Web client         | React, Vite                                      |
| Tests              | Vitest, supertest                                |
| Packaging          | Docker, Docker Compose                           |
| Documentation      | Markdown, Mermaid                                |
