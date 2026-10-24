# 02 Architecture

## Container view

```mermaid
flowchart LR
  Browser["Web client<br/>React + Vite + TypeScript"]
  GW["API Gateway<br/>Express: JWT check and routing"]
  subgraph svc ["Microservices"]
    US["User Service"]
    CS["Catalog Service"]
    CRT["Cart Service"]
    OS["Order Service"]
    NS["Notification Service"]
  end
  MQ{{"RabbitMQ<br/>topic exchange bookstore.events"}}
  UDB[("user-db")]
  CDB[("catalog-db")]
  RDB[("cart-db")]
  ODB[("order-db")]
  NDB[("notification-db")]

  Browser -->|"REST / JSON"| GW
  Browser -.->|"SSE stream"| GW
  GW --> US
  GW --> CS
  GW --> CRT
  GW --> OS
  GW --> NS
  US --- UDB
  CS --- CDB
  CRT --- RDB
  OS --- ODB
  NS --- NDB
  CRT -->|"REST: does the book exist?"| CS
  OS -->|"REST: read cart"| CRT
  OS -->|"REST: reserve stock"| CS
  OS ==>|"publish order.*"| MQ
  MQ ==>|"order.placed"| CRT
  MQ ==>|"order.cancelled"| CS
  MQ ==>|"order.*"| NS
```

| Container            | Technology            | Responsibility                                       |
| -------------------- | --------------------- | ---------------------------------------------------- |
| Web client           | React, Vite           | UI for customers and admins; talks only to the gateway |
| API Gateway          | Express               | Single entry point, JWT verification, routing, SSE pass-through |
| User Service         | Express, SQLite       | Identity                                             |
| Catalog Service      | Express, SQLite       | Books and stock                                      |
| Cart Service         | Express, SQLite       | Carts                                                |
| Order Service        | Express, SQLite       | Orders and event publishing                          |
| Notification Service | Express, SQLite       | Event consumer and SSE stream                        |
| RabbitMQ             | Message broker        | Topic exchange `bookstore.events`                    |

## Component view of one service

All five services use the same internal layers, so they are easy to read and test.

```mermaid
flowchart TB
  R["routes<br/>HTTP endpoints"] --> V["validation<br/>zod schemas"]
  V --> S["service layer<br/>business rules"]
  S --> REPO["repository<br/>SQL access"]
  REPO --> DB[("SQLite file")]
  S --> CL["clients<br/>REST calls to other services"]
  S --> PUB["event publisher / consumer<br/>RabbitMQ"]
```

## Deployment view

```mermaid
flowchart TB
  subgraph compose ["docker compose up (one internal network)"]
    FE["frontend :5173"]
    GW["gateway :3000"]
    US["user-service :3001"]
    CS["catalog-service :3002"]
    CRT["cart-service :3003"]
    OS["order-service :3004"]
    NS["notification-service :3005"]
    MQ{{"rabbitmq :5672 and :15672"}}
    VOL[("one SQLite file per service<br/>each in its own volume")]
  end
  FE --> GW
  GW --> US & CS & CRT & OS & NS
  OS --> MQ
  MQ --> CRT & CS & NS
  US & CS & CRT & OS & NS --- VOL
```

Only the gateway and the frontend are meant to be reached from outside. The services are not routed through the gateway for `/internal/*` paths, so internal endpoints cannot be called from the browser.

## Security model

| Concern              | Approach                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Passwords            | Hashed with bcrypt, never stored or logged in plain text                                          |
| Authentication       | User Service issues a signed JWT (user id, role, expiry); gateway verifies signature and expiry    |
| Passing identity     | Gateway adds `X-User-Id` and `X-User-Role` headers; services trust them because they are only reachable on the internal network |
| Authorization        | Role checks in the services (admin-only endpoints) and ownership checks (a customer sees only own orders) |
| Internal endpoints   | Paths under `/internal/` are never proxied by the gateway                                         |
| Input                | Every request body is validated with zod before use                                               |
| Secrets              | JWT secret and broker credentials come from environment variables, not from the repository        |

## Planned repository layout

```
project/
  docs/                  documentation and Mermaid diagrams
  gateway/               API gateway
  frontend/              React web client
  services/
    user-service/
    catalog-service/
    cart-service/
    order-service/
    notification-service/
  shared/                shared TypeScript types (event contracts)
  tests/                 end-to-end tests
  docker-compose.yml
```
