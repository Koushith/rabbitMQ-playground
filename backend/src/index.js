import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { getChannel } from './rabbit.js';
import {
  EXCHANGE,
  ROUTING_KEY,
  MAIN_QUEUE,
  DLQ,
  MGMT_URL,
  MGMT_AUTH,
} from './config.js';

const app = express();
app.use(cors());
app.use(express.json());

// --- in-memory order tracker -----------------------------------------------
// RabbitMQ only holds messages that haven't been delivered yet. Once a chef
// acks a pizza, the message is *gone* from the queue — so the broker can't
// tell us "here are all the orders ever placed and what happened to each."
// For the UI's order-tracker view we keep our own map keyed by order id.
// Workers POST status updates to us as they go. A real app would use a
// database; for a demo, a capped Map is plenty.
const MAX_ORDERS = 500;
const orders = new Map();

function rememberOrder(order) {
  orders.set(order.id, order);
  if (orders.size > MAX_ORDERS) {
    const oldest = orders.keys().next().value;
    orders.delete(oldest);
  }
}

// --- health ----------------------------------------------------------------
app.get('/health', (_, res) => res.json({ ok: true }));

// --- customer places an order ---------------------------------------------
app.post('/orders', async (req, res) => {
  const {
    type = 'Margherita',
    ovenTooHot = false,
    bakeTimeMs = 2000,
  } = req.body ?? {};

  const ch = await getChannel();
  const order = {
    id: randomUUID(),
    type,
    ovenTooHot,
    bakeTimeMs,
    status: 'waiting',
    attempts: 0,
    chef: null,
    createdAt: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), event: 'ordered' }],
  };

  rememberOrder(order);
  ch.publish(EXCHANGE, ROUTING_KEY, Buffer.from(JSON.stringify(order)), {
    persistent: true,
    contentType: 'application/json',
    headers: { 'x-retry-count': 0 },
  });

  res.json(order);
});

// --- list recent orders (newest first) ------------------------------------
app.get('/orders', (req, res) => {
  const { status } = req.query;
  let list = Array.from(orders.values()).reverse();
  if (status) list = list.filter((o) => o.status === status);
  res.json(list.slice(0, 100));
});

// --- single order with full history ---------------------------------------
app.get('/orders/:id', (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'unknown order' });
  res.json(o);
});

// --- workers report progress here -----------------------------------------
// Called by the chef process as a pizza moves through states.
app.post('/orders/:id/events', (req, res) => {
  const { id } = req.params;
  const { event, chef, attempt, reason } = req.body ?? {};
  const order = orders.get(id);
  if (!order) return res.status(404).json({ error: 'unknown order' });

  order.history.push({
    at: new Date().toISOString(),
    event,
    chef,
    attempt,
    reason,
  });

  if (event === 'cooking') {
    order.status = 'cooking';
    order.chef = chef;
    order.attempts = attempt ?? order.attempts;
  } else if (event === 'delivered') {
    order.status = 'delivered';
  } else if (event === 'burnt') {
    order.status = 'burnt';
  }
  // 'failed' is an interim state between attempts — don't flip status yet.

  res.json({ ok: true });
});

// --- live stats (proxies RabbitMQ management API, renamed to pizzeria terms)
app.get('/stats', async (_req, res) => {
  try {
    const [kitchen, burnt] = await Promise.all([
      fetchQueue(MAIN_QUEUE),
      fetchQueue(DLQ),
    ]);
    res.json({
      kitchen: {
        waiting: kitchen.messagesReady,      // in queue, no chef yet
        cooking: kitchen.messagesUnacked,    // a chef is working on it
        chefs: kitchen.consumers,            // how many workers connected
        ordersPerSec: kitchen.publishRate,
        cookingPerSec: kitchen.deliverRate,
        deliveriesPerSec: kitchen.ackRate,
      },
      burnt: {
        count: burnt.messages,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function fetchQueue(name) {
  // "%2F" is the URL-encoded default vhost "/"
  const r = await fetch(`${MGMT_URL}/queues/%2F/${name}`, {
    headers: { Authorization: MGMT_AUTH },
  });
  if (!r.ok) throw new Error(`mgmt api ${r.status} on ${name}`);
  const q = await r.json();
  return {
    messages: q.messages ?? 0,
    messagesReady: q.messages_ready ?? 0,
    messagesUnacked: q.messages_unacknowledged ?? 0,
    consumers: q.consumers ?? 0,
    publishRate: q.message_stats?.publish_details?.rate ?? 0,
    deliverRate: q.message_stats?.deliver_details?.rate ?? 0,
    ackRate: q.message_stats?.ack_details?.rate ?? 0,
  };
}

// --- burnt pizzas (the DLQ) ------------------------------------------------
app.get('/burnt', async (_req, res) => {
  try {
    const r = await fetch(`${MGMT_URL}/queues/%2F/${DLQ}/get`, {
      method: 'POST',
      headers: {
        Authorization: MGMT_AUTH,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        count: 50,
        ackmode: 'ack_requeue_true', // non-destructive peek
        encoding: 'auto',
      }),
    });
    if (!r.ok) throw new Error(`mgmt api ${r.status}`);
    const msgs = await r.json();
    res.json(
      msgs.map((m) => ({
        payload: safeParse(m.payload),
        properties: m.properties,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send all burnt pizzas back to the kitchen queue (retry-count reset).
app.post('/burnt/resend', async (_req, res) => {
  const ch = await getChannel();
  let count = 0;
  while (true) {
    const msg = await ch.get(DLQ, { noAck: false });
    if (!msg) break;
    ch.publish(EXCHANGE, ROUTING_KEY, msg.content, {
      persistent: true,
      contentType: 'application/json',
      headers: { 'x-retry-count': 0 },
    });
    ch.ack(msg);
    count++;
  }
  res.json({ ok: true, resent: count });
});

// Throw away everything in the burnt bin.
app.post('/burnt/trash', async (_req, res) => {
  const ch = await getChannel();
  const { messageCount } = await ch.purgeQueue(DLQ);
  res.json({ ok: true, trashed: messageCount });
});

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  try {
    await getChannel();
    console.log(`[api] listening http://localhost:${PORT}`);
    console.log(`[api] rabbitmq admin http://localhost:15672 (admin/admin)`);
  } catch (err) {
    console.error('[api] failed to connect to RabbitMQ:', err.message);
  }
});
