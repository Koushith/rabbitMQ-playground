import amqp from 'amqplib';
import {
  RABBIT_URL,
  EXCHANGE,
  MAIN_QUEUE,
  DLX,
  DLQ,
  ROUTING_KEY,
  DLQ_ROUTING_KEY,
} from './config.js';

let connection;
let channel;

export async function getChannel() {
  if (channel) return channel;
  connection = await amqp.connect(RABBIT_URL);
  channel = await connection.createChannel();

  connection.on('close', () => { connection = null; channel = null; });
  connection.on('error', (err) => console.error('[rabbit] connection error', err.message));

  await setupTopology(channel);
  return channel;
}

// Idempotent — safe to call from backend AND every worker on boot.
async function setupTopology(ch) {
  await ch.assertExchange(EXCHANGE, 'direct', { durable: true });

  // Dead-letter side first so the main queue can reference it.
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
}
