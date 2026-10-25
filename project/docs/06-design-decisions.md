# 06 Design decisions

[Index](README.md) · [01 Overview](01-overview.md) · [02 Architecture](02-architecture.md) · [03 Communication](03-communication.md) · [04 Data model](04-data-model.md) · [05 API](05-api-reference.md) · [06 Design decisions](06-design-decisions.md)

## Decisions

| #  | Decision                                  | Reason                                                                                          | Trade-off accepted                                             |
| -- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D1 | Five microservices split by business area | Each owns one area and its data; matches the course requirement and bounded contexts            | More moving parts than one application; more operations work   |
| D2 | Database per service (SQLite files)       | No shared tables means no hidden coupling; each service can change its schema alone             | No joins across services; some data is duplicated by id        |
| D3 | REST for questions, events for news       | Checkout needs an immediate answer; "order placed" only needs to be announced                   | Two communication styles to understand and test                |
| D4 | RabbitMQ topic exchange                   | One publisher, several independent consumers with their own queues                              | Needs a broker; delivery is at-least-once, so consumers must be idempotent |
| D5 | WebSocket for live notifications         | One persistent two-way connection per browser, no polling; matches the course material on WebSocket | Needs heartbeat, reconnect and resync logic; scaling to several instances needs care |
| D6 | JWT verified at the gateway               | One place checks tokens; services stay simple                                                   | Services trust the gateway, so they must not be exposed directly |
| D7 | No distributed transaction (no 2PC)       | Stock is reserved first; if saving the order fails, the reservation is released; cancel releases stock via an event | Short moments of inconsistency are possible (eventual consistency) |
| D8 | Order items store a price snapshot        | History must not change when a book changes                                                     | Small data duplication                                         |
| D9 | Gateway never proxies `/internal/*`       | Service-to-service endpoints stay private                                                       | Internal calls must use the service address directly           |

## Known limitations

- Payment, e-mail delivery and shipping are simulated; there is no real integration.
- The reserve call and the order save are not one atomic transaction. The compensation (release) covers normal failures, but a crash between the two steps can leave stock reserved without an order. A cleanup job would be the next step.
- SQLite is used for simplicity. A production system would use a server database such as PostgreSQL.
- The gateway is a single instance and a single point of failure; a real deployment would run several behind a load balancer.
- No rate limiting and no refresh tokens.
- The WebSocket token in the query string can appear in logs; short-lived tokens limit the risk.

## Likely questions

**Why is this not a distributed monolith?**
Services have separate databases and separate deployments, no shared code except event type definitions, and the only synchronous dependencies are the few calls listed in the communication page. The Notification Service can be down without affecting orders.

**What happens if two customers buy the last copy at the same time?**
The reserve call runs as a single database transaction in the Catalog Service that checks and decreases stock together. One succeeds, the other gets `409`.

**What if the same event arrives twice?**
Consumers save the `eventId` of every processed event and ignore repeats.

**Why not make everything asynchronous?**
The customer must know immediately whether the order was accepted. Asynchronous order creation would need a "pending" state and more complexity without benefit here.

**Why WebSocket and not SSE or polling?**
The system needs live updates without reloading the page. A WebSocket gives one persistent connection per browser and no repeated requests. SSE would also work for one-way updates and is simpler, but WebSocket also leaves room for two-way features and matches the course material. Polling wastes requests and adds delay.

**Why a gateway?**
The browser needs one address, and token checking and routing live in one place instead of five.

**How would you scale it?**
Run more copies of the busy services (Catalog and Cart) behind the gateway. The services are stateless apart from their own database, and consumers can share a queue. For the Notification Service, each instance would need its own queue so that every instance sees every event, and it would push only to the sockets connected to it.
