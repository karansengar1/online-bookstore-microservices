# Online Bookstore – Microservices

A microservice-based web application for browsing, ordering and tracking books online.

**Problem.** Small bookshops that sell online often run everything in one program. A bug in the cart can take the whole shop down, stock and orders get out of sync, and customers hear about their order only when they check manually.

**Users.**

- **Customers** register, browse and search books, fill a cart, place orders, cancel an order that has not shipped, and receive live notifications about their orders.
- **Admins** manage the book catalogue (add, edit, remove, set stock) and move orders through shipping and delivery.

**Solution in short.** Five TypeScript microservices (User, Catalog, Cart, Order, Notification) behind an API gateway, a React web client, and a RabbitMQ message broker. Services talk over REST when they need an immediate answer and over events when they only need to be told that something happened. Each service owns its own data. Order updates reach the browser live over WebSocket.

**Status.** Implemented: all five microservices (User, Catalog, Cart, Order, Notification), the API gateway and the React web client, with about 100 automated tests and an end-to-end test. See the documents below.

## How to run

Requirements: Node.js 22 and Docker Desktop (RabbitMQ runs in Docker).

```
cd project
npm install
npm run infra:up      # starts RabbitMQ
npm run dev:all       # starts the five services, the gateway and the web client
```

Then open http://localhost:5173. Admin login: `admin@bookstore.local` / `Admin12345`. Customers register in the web client.

```
npm test              # all unit and API tests
npm run e2e           # end-to-end test of the running system (dev:all must be running)
```

## Timeline

| Week            | Goal / Milestone                                   | Verifiable result                                      |
| --------------- | -------------------------------------------------- | ------------------------------------------------------ |
| 24–25 Oct       | Architecture and documentation                     | [`docs/`](docs/) with Mermaid diagrams                 |
| 26–28 Oct       | API gateway, User service, Catalog service         | Login works, books can be listed and searched          |
| 29 Oct – 1 Nov  | Cart service, Order service, RabbitMQ              | Placing an order publishes `order.placed`              |
| 2–4 Nov         | Notification service, WebSocket, web client        | Client in `project/`, live updates working             |
| 5–8 Nov         | Tests and final documentation                      | `npm test` and `npm run e2e` pass                      |

## GitHub Projects

- [Project Board](https://github.com/users/karansengar1/projects/1)
- The board shows the **Todo → In progress → Done** status of specific tasks and is also accessible to the instructor.

## Additional documents

| Document                                  | Contents                                                              |
| ----------------------------------------- | --------------------------------------------------------------------- |
| [Documentation index](docs/README.md)     | Overview of all pages and the high-level architecture                 |
| [01 Overview](docs/01-overview.md)        | Requirements, system context, services, use cases, technology         |
| [02 Architecture](docs/02-architecture.md) | Container and component views, deployment, security model            |
| [03 Communication](docs/03-communication.md) | Synchronous and asynchronous flows, login, WebSocket, failure behaviour  |
| [04 Data model](docs/04-data-model.md)    | ER diagram, data owned by each service, message contracts, validation |
| [05 API reference](docs/05-api-reference.md) | Gateway routing, endpoints with access rules, events               |
| [06 Design decisions](docs/06-design-decisions.md) | Decisions, known limitations, likely questions               |

All diagrams are written in Mermaid; their sources are in [`docs/diagrams/`](docs/diagrams/).
