# Pizzeria — a pub/sub learning app

A tiny end-to-end app that simulates a pizzeria so you can *see* pub/sub in
action. The queue names mirror the story, not abstract jargon:

| Pizzeria term     | RabbitMQ term         | What it is |
|-------------------|-----------------------|------------|
| `pizzeria`        | exchange (direct)     | Where new orders are sent. |
| `kitchen`         | main queue            | Pizzas waiting for a chef. |
| chef              | consumer / worker     | A background process that cooks pizzas. |
| `incinerator`     | dead-letter exchange  | Routes pizzas nobody could cook. |
| `burnt-pizzas`    | dead-letter queue     | The trash bin — pizzas that failed too many times. |

## What the app simulates

1. A **customer** (you, clicking a button) places a pizza order.
2. The **backend** (Express) drops the order into the `kitchen` queue and returns immediately — customer doesn't wait for cooking.
3. A **chef** (worker process) picks up the order, takes some time to bake, then delivers it.
4. If the oven is "too hot" the pizza burns. The chef retries 3 times; if it still burns, the order goes into the **trash** (dead-letter queue) instead of being lost.
5. You can **send burnt pizzas back to the kitchen** or throw them away.

This is exactly how Shopify sends emails, how Stripe delivers webhooks, how Uber dispatches rides. Same pattern, smaller stakes.

## Architecture

```
   Browser (React)              Express API                    Chef processes
   ──────────────               ───────────                     ──────────────
   Order pizza  ───POST /orders──▶  publish  ───┐
   Show queue state ◀─GET /stats ───fetch───┐   │
   Show each order ◀─GET /orders            │   │
                                            │   ▼
                                      ┌─────────────────┐       ┌──────────┐
                                      │    RabbitMQ     │       │ chef-1   │
                                      │                 │       │ chef-2   │
                                      │ pizzeria ──▶ kitchen◀──▶│ chef-…   │
                                      │                 │       └──────────┘
                                      │     retries exhausted →          │
                                      │     incinerator ──▶ burnt-pizzas │
                                      └─────────────────┘                │
                                                                         ▼
                                                              POST /orders/:id/events
                                                              (chefs report status
                                                              back to the API so the
                                                              order-tracker UI can
                                                              show what's happening)
```

Three deployables: **`backend/`**, **`worker/`**, **`frontend/`**. Each has its
own README explaining what it does.

## Run it (4 terminals)

```bash
# 0) Make sure Docker is running

# 1) Start RabbitMQ
docker compose up -d

# 2) Backend API
cd backend && npm install && npm run dev     # → http://localhost:3001

# 3) A chef (open a new terminal)
cd worker && npm install && npm run dev

# 4) Frontend (another terminal)
cd frontend && npm install && npm run dev    # → http://localhost:5173
```

Open the app: **http://localhost:5173**
RabbitMQ's own admin dashboard: **http://localhost:15672** (admin / admin)

## Things to try in the UI

1. **Happy path.** Pick a pizza, click *Order 1*. Watch the order tracker cycle through `waiting → cooking → delivered`.
2. **Add a second chef.** Open another terminal, run `WORKER_ID=chef-luigi npm run dev` in `worker/`. Click *Order 10*. "Chefs on duty" goes to 2; orders split between them.
3. **See the DLQ in action.** Click *Order 5 that will burn*. Each one will be attempted 4 times (initial + 3 retries), then land in the trash. The order tracker shows `burnt`.
4. **Recover.** Click *Send back to kitchen* — the burnt orders go back through the same pipeline. (They'll burn again because the payload still says "oven too hot" — that's the point: the message carries its own instructions. In a real app you'd fix the bug before requeuing.)
5. **Crash a chef.** While orders are cooking, Ctrl-C a worker. Watch "Cooking now" snap back to "Waiting" — the broker didn't hear an ack, so it redelivers. This is **at-least-once delivery**.

## What happens inside the queue (and why you can't see it all in one place)

- The **kitchen queue** only holds pizzas *not yet cooked*. Once a chef acks an order, it's gone from the queue. That's why "how many ever ordered?" isn't something the queue can answer — the backend tracks it separately in memory.
- **Waiting** = in queue, no chef has picked it up yet.
- **Cooking** = a chef pulled it but hasn't acked yet (these are "unacknowledged" in RabbitMQ).
- **Chefs on duty** = how many worker processes are subscribed.
- **In the trash** = sitting in the `burnt-pizzas` queue, unhandled.

## Project layout

```
PUB-SUB/
├── docker-compose.yml   RabbitMQ (image + mgmt plugin on :15672)
├── backend/             Express API — see backend/README.md
├── worker/              Chef process — see worker/README.md
├── frontend/            React UI — see frontend/README.md
└── README.md            (you're here)
```
# rabbitMQ-playground
