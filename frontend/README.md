# frontend — the pizzeria UI

A React + Vite single-page app. Its only job is to **make the pub/sub system
observable**: you can see orders queued up, being cooked, delivered, or in
the trash — in real time.

## The four sections of the UI

| Section | What it shows | Backed by |
|---|---|---|
| **1. Place an order** | Pick a pizza, set bake time, optionally tick "oven too hot" so it will burn. | `POST /orders` |
| **2. Kitchen right now** | Four big tiles: *Waiting to cook*, *Cooking now*, *Chefs on duty*, *In the trash*. Plus per-second rates. | `GET /stats` |
| **3. Order tracker** | Every pizza you've ever ordered (last 100), with live status (`waiting`/`cooking`/`delivered`/`burnt`), which chef is/was working on it, and how many attempts it took. | `GET /orders` |
| **4. Trash** | Burnt pizzas that gave up after retries. "Send back to kitchen" republishes them; "Throw away" purges. | `GET /burnt`, `POST /burnt/resend`, `POST /burnt/trash` |

## How the live view works

A `setInterval` in `App.jsx` polls the three `GET` endpoints every 1 second
and re-renders. No websockets, no SSE — just polling, because it's easy to
read and more than fast enough for a learning lab.

The backend endpoints are themselves either:
- **RabbitMQ management API proxies** (`/stats`, `/burnt`) — so you see numbers straight from the broker, and
- **Backend-tracked state** (`/orders`) — populated via status callbacks the chefs POST as they work.

## Files

```
frontend/
├── index.html           Vite entry — mounts <App/>
├── vite.config.js       Vite + React plugin, dev server on :5173
└── src/
    ├── main.jsx         ReactDOM.createRoot bootstrap
    ├── App.jsx          The whole UI (kept as one file — easy to read for learning)
    └── styles.css       Dark theme + status badges (waiting/cooking/delivered/burnt)
```

## Run

```bash
npm install
npm run dev            # → http://localhost:5173
```

It expects the backend at `http://localhost:3001`. If you change the backend
port, edit the `API` constant at the top of `App.jsx`.

## Status badge colors

- **waiting** (grey) — in the queue, no chef yet
- **cooking** (orange) — a chef is working on it
- **delivered** (green) — successfully acked
- **burnt** (red) — gave up after all retries; now in the trash

## What this UI deliberately doesn't show

- Message bodies, bindings, per-worker consumer tags, exchange wiring. For those, click "RabbitMQ admin ↗" in the header — the built-in dashboard at :15672 is the right tool for that.
