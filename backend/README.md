# backend — the Express API

The **customer-facing side** of the pizzeria. It does three jobs:

1. **Takes orders** from the UI and drops them on the `kitchen` queue.
2. **Tracks each order** in memory so the UI can show a per-pizza timeline (waiting → cooking → delivered/burnt). RabbitMQ itself *can't* answer "what happened to order X" because once a message is acked it's gone.
3. **Exposes stats** about the queues by proxying RabbitMQ's management HTTP API.

It does **not** cook pizzas — that's the worker's job.

## Files

| File | What it does |
|---|---|
| `src/config.js` | Queue/exchange names (pizzeria / kitchen / incinerator / burnt-pizzas) + RabbitMQ URLs. |
| `src/rabbit.js` | Connects to RabbitMQ, declares the topology (exchange, main queue with DLX argument, dead-letter exchange, DLQ, bindings). Idempotent. |
| `src/index.js`  | Express app + in-memory order Map + all routes. |

## Routes

| Method | Path | Purpose |
|---|---|---|
| POST   | `/orders`               | Customer places an order. Publishes to `pizzeria` exchange with routing key `order`. Returns the order record. |
| GET    | `/orders`               | List recent orders (newest first, max 100). Backed by the in-memory map. |
| GET    | `/orders/:id`           | Full history for a single order. |
| POST   | `/orders/:id/events`    | **Internal** — chefs POST here as they progress (cooking / delivered / failed / burnt). |
| GET    | `/stats`                | Live queue counters — waiting, cooking, chefs on duty, burnt count, per-second rates. Proxies RabbitMQ mgmt API. |
| GET    | `/burnt`                | Peek at messages in the DLQ (non-destructive). |
| POST   | `/burnt/resend`         | Drain the DLQ and republish everything to the main kitchen queue. |
| POST   | `/burnt/trash`          | Purge the DLQ. |
| GET    | `/health`               | `{ ok: true }`. |

## How order tracking works

```
  customer         Express API                 chef
  ────────         ───────────                  ────
  POST /orders ─▶  create order record
                   status=waiting
                   remember it in Map
                   publish to kitchen queue
                                                consume
                                                POST /orders/:id/events { event: cooking }
                                                   (API updates: status=cooking, chef=…, attempts=1)
                                                bake…
                                                POST /orders/:id/events { event: delivered }
                                                   (API updates: status=delivered)
```

The in-memory Map is capped at 500 entries — older orders drop off. A real app
would put this in Postgres or Redis; in-memory is fine for a learning lab.

## Why we proxy RabbitMQ's mgmt API (instead of reading the queues directly)

Reading messages out of a queue via AMQP is *destructive by default* — you'd
either consume them (they leave the queue) or have to re-publish. RabbitMQ's
HTTP management API has a `get` endpoint with `ackmode: ack_requeue_true` that
peeks without disturbing the queue. That's what `GET /burnt` uses.

Live counters (`/stats`) come from the same API — it's the same data the
admin UI at :15672 shows, just re-shaped into friendlier field names.

## Run

```bash
npm install
npm run dev       # auto-reload
# or
npm start
```

Env vars (all optional):
- `PORT` — default `3001`
- `RABBIT_URL` — default `amqp://admin:admin@localhost:5672`
- `MGMT_URL` — default `http://localhost:15672/api`
