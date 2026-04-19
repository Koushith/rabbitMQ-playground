import amqp from 'amqplib';

const RABBIT_URL =
  process.env.RABBIT_URL || 'amqp://admin:admin@localhost:5672';
const API_URL = process.env.API_URL || 'http://localhost:3001';

// These names match backend/src/config.js — keep in sync.
const EXCHANGE = 'pizzeria';
const MAIN_QUEUE = 'kitchen';
const DLX = 'incinerator';
const DLQ = 'burnt-pizzas';
const ROUTING_KEY = 'order';
const DLQ_ROUTING_KEY = 'burnt';

const CHEF_ID = process.env.WORKER_ID || `chef-${process.pid}`;
const PREFETCH = Number(process.env.PREFETCH || 2);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${CHEF_ID}]`, ...a);

// Fire-and-forget status update to the backend, so the UI can show a
// live per-order timeline. If the HTTP call fails, the pub/sub work still
// completes — we never block queue processing on reporting.
function report(id, event, extra = {}) {
  fetch(`${API_URL}/orders/${id}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, chef: CHEF_ID, ...extra }),
  }).catch(() => {});
}

async function main() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();

  // Every process declares the same topology. `assert*` is idempotent, so
  // running this from both backend and every worker is safe.
  await ch.assertExchange(EXCHANGE, 'direct', { durable: true });
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, DLQ_ROUTING_KEY);
  await ch.assertQueue(MAIN_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DLX,
      'x-dead-letter-routing-key': DLQ_ROUTING_KEY,
    },
  });
  await ch.bindQueue(MAIN_QUEUE, EXCHANGE, ROUTING_KEY);

  // prefetch = how many unacked orders this chef holds at once.
  await ch.prefetch(PREFETCH);
  log(`ready. prefetch=${PREFETCH} maxRetries=${MAX_RETRIES}`);

  await ch.consume(MAIN_QUEUE, async (msg) => {
    if (!msg) return;
    const order = JSON.parse(msg.content.toString());
    const retry = Number(msg.properties.headers?.['x-retry-count'] ?? 0);
    const attempt = retry + 1;
    const short = order.id.slice(0, 6);

    log(`cooking ${order.type} #${short} (attempt ${attempt})`);
    report(order.id, 'cooking', { attempt });

    try {
      await sleep(order.bakeTimeMs ?? 2000);
      if (order.ovenTooHot) throw new Error('oven too hot');

      ch.ack(msg);
      log(`delivered ${order.type} #${short}`);
      report(order.id, 'delivered');
    } catch (err) {
      report(order.id, 'failed', { reason: err.message, attempt });

      if (retry < MAX_RETRIES) {
        // Republish with an incremented retry counter, then ack the original
        // so it stops blocking the queue. (Simple retry — no backoff delay.)
        ch.publish(EXCHANGE, ROUTING_KEY, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: { 'x-retry-count': retry + 1 },
        });
        ch.ack(msg);
        log(`retrying ${order.type} #${short} — ${err.message}`);
      } else {
        // nack with requeue=false → RabbitMQ routes via DLX → burnt-pizzas.
        ch.nack(msg, false, false);
        log(`burnt ${order.type} #${short} (gave up after ${attempt} attempts)`);
        report(order.id, 'burnt', { reason: err.message });
      }
    }
  });
}

main().catch((err) => {
  console.error(`[${CHEF_ID}] fatal:`, err);
  process.exit(1);
});
