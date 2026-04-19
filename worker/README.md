# worker — a chef

A standalone Node process that **consumes pizza orders from the `kitchen`
queue, cooks them, and acknowledges them.** Run several copies of this in
different terminals to get competing consumers — RabbitMQ load-balances
orders across them.

## What one "cook" cycle looks like

```
  kitchen queue ──▶ chef receives order (msg)
                    │
                    ├─ report "cooking" to backend (for the UI tracker)
                    ├─ await sleep(bakeTimeMs)   ← simulates doing real work
                    │
                    ├─ success? ───▶ ch.ack(msg)
                    │                report "delivered"
                    │
                    └─ failure?
                         ├─ retries < 3?  republish with x-retry-count + 1 + ack original
                         │                report "failed" (between attempts)
                         │
                         └─ retries ≥ 3?  ch.nack(msg, false, false)
                                          → RabbitMQ routes via DLX → burnt-pizzas
                                          report "burnt"
```

## Key pub/sub mechanics this file demonstrates

| Concept | Where in the code |
|---|---|
| **Assert topology** (declare exchange + queue + bindings) | top of `main()` — safe and idempotent, every process can do this on boot |
| **QoS / prefetch** | `ch.prefetch(PREFETCH)` — "don't give me more than N unacked messages at once" |
| **Consume with manual ack** | `ch.consume(MAIN_QUEUE, async (msg) => …)` |
| **Ack on success** | `ch.ack(msg)` — tells broker: safe to forget this message |
| **Retry with a header counter** | `x-retry-count` is a custom header; on failure we republish the message with it incremented, then ack the original |
| **Route to DLQ** | `ch.nack(msg, false, false)` — false/false = don't bulk-ack, don't requeue; broker then routes via `x-dead-letter-exchange` → `incinerator` → `burnt-pizzas` |

## Why a worker is a separate process (not part of the backend)

Because that's how real systems deploy. The web server handles HTTP requests
and needs to respond fast; the worker does slow background work and can be
scaled independently. They share nothing except the queue itself — you could
deploy 20 workers and 2 web servers, or rewrite the worker in Python, and
nothing else would need to change.

## Chefs reporting status to the backend (via HTTP)

After each state change the chef fires `POST /orders/:id/events` to the backend
so the UI can show a live per-order status. It's **fire-and-forget** — if the
backend is down or slow, the pub/sub pipeline still works perfectly.

A more "pub-sub-native" variant would be to publish status events to a second
exchange that the backend consumes — good exercise to try next.

## Run

```bash
npm install
npm run dev
```

### Spin up multiple chefs

Each one is just another process. Open more terminals:

```bash
WORKER_ID=chef-mario npm run dev
WORKER_ID=chef-luigi npm run dev
WORKER_ID=chef-peach PREFETCH=5 npm run dev
```

### Env vars (all optional)

| Var | Default | What |
|---|---|---|
| `WORKER_ID` | `chef-<pid>` | Shows up in logs and in the order tracker |
| `PREFETCH`  | `2` | Max unacked pizzas this chef holds at once |
| `MAX_RETRIES` | `3` | Retries before sending to the trash |
| `RABBIT_URL`  | `amqp://admin:admin@localhost:5672` | |
| `API_URL`     | `http://localhost:3001` | Where to POST status callbacks |

## What to watch for

- Kill a chef mid-cook (`Ctrl-C`). The messages they were holding pop back to "Waiting to cook" in the UI — **RabbitMQ redelivers unacked messages**.
- Raise `PREFETCH` and publish a burst — one chef can now keep more pizzas "cooking" at once.
- Set `bakeTimeMs` high on an order and watch how many pizzas sit in *waiting* vs *cooking* — exactly `PREFETCH × chefs` will be cooking; the rest queue up.
