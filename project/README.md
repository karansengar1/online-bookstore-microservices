# Online Bookstore – Microservices

A microservice-based web application for browsing, ordering and tracking books online.

**Problem.** Small bookshops that sell online often run everything in one program. A bug in the cart can take the whole shop down, stock and orders get out of sync, and customers hear about their order only when they check manually.

**Users.**

- **Customers** register, browse and search books, fill a cart, place orders, cancel an order that has not shipped, and receive live notifications about their orders.
- **Admins** manage the book catalogue (add, edit, remove, set stock) and move orders through shipping and delivery.

**Solution in short.** Five TypeScript microservices (User, Catalog, Cart, Order, Notification) behind an API gateway, a React web client, and a RabbitMQ message broker. Services talk over REST when they need an immediate answer and over events when they only need to be told that something happened. Each service owns its own data. Order updates reach the browser live over Server-Sent Events.

**Status.** The design and documentation are complete (see below). The implementation is added to this folder step by step.

## Timeline

Replace the week labels with real dates when you plan your own schedule.

| Week   | Goal / Milestone                          | Verifiable result                                    |
| ------ | ----------------------------------------- | ---------------------------------------------------- |
| Week 1 | Architecture and documentation            | [`docs/`](docs/) with Mermaid diagrams               |
| Week 2 | Backend microservices and API gateway     | Services and gateway in `project/`                   |
| Week 3 | Web client and real-time notifications    | Client in `project/`, live updates working           |
| Week 4 | Docker setup, tests, final documentation  | `docker compose up` runs the system, tests pass      |

## GitHub Projects

Project board: **ADD THE LINK TO YOUR GITHUB PROJECTS BOARD HERE** – tasks for each timeline milestone.

## Additional documents

| Document                                  | Contents                                                              |
| ----------------------------------------- | --------------------------------------------------------------------- |
| [Documentation index](docs/README.md)     | Overview of all pages and the high-level architecture                 |
| [01 Overview](docs/01-overview.md)        | Requirements, system context, services, use cases, technology         |
| [02 Architecture](docs/02-architecture.md) | Container and component views, deployment, security model            |
| [03 Communication](docs/03-communication.md) | Synchronous and asynchronous flows, login, SSE, failure behaviour  |
| [04 Data model](docs/04-data-model.md)    | ER diagram, data owned by each service, message contracts, validation |
| [05 API reference](docs/05-api-reference.md) | Gateway routing, endpoints with access rules, events               |
| [06 Design decisions](docs/06-design-decisions.md) | Decisions, known limitations, likely questions               |

All diagrams are written in Mermaid; their sources are in [`docs/diagrams/`](docs/diagrams/).
