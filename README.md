# shoplab-orders

Order lifecycle and state machine. Express + Postgres.

State machine: `placed` -> `paid` -> `packed` -> `shipped`; `placed`, `paid` and `packed` can also go to `cancelled`. `shipped` and `cancelled` are final. Invalid moves return 409.

| Endpoint | Notes |
| --- | --- |
| `GET /orders` | the caller's order history, newest first (JWT from iam) |
| `GET /orders/:id` | owner, staff or admin; includes lines |
| `POST /orders/:id/cancel` | owner, staff or admin; publishes `order.cancelled` |
| `POST /orders/:id/pack`, `/ship` | staff or admin |

**Consumes** `cart.checked_out` (creates the order, idempotent on `cartId`, looks up unit prices with `GET {CATALOG_API_URL}/products/:id`, publishes `order.placed`), `payment.captured` (placed -> paid) and `payment.failed` (recorded in the order history, order stays placed).
**Publishes** `order.placed`, `order.cancelled`.

Env: `DATABASE_URL`, `JWT_SECRET` (shared with iam), `CATALOG_API_URL`, `RABBITMQ_URL`, `PORT`.
`npm test` uses an in-memory store; set `TEST_DATABASE_URL` to also run migrations, the Postgres store and a concurrent-transition test.
`npm run seed` creates the same 100 orders every time (seed shoppers use stable ids that are not iam's user ids).
