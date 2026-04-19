export const RABBIT_URL =
  process.env.RABBIT_URL || 'amqp://admin:admin@localhost:5672';
export const MGMT_URL = process.env.MGMT_URL || 'http://localhost:15672/api';
export const MGMT_AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');

// Friendly names — the "Pizzeria" theme:
//   pizzeria          : the exchange customers send orders to
//   kitchen           : main queue where waiting pizzas live
//   incinerator       : dead-letter exchange (where burnt pizzas are routed)
//   burnt-pizzas      : dead-letter queue (the trash bin)
export const EXCHANGE = 'pizzeria';
export const MAIN_QUEUE = 'kitchen';
export const DLX = 'incinerator';
export const DLQ = 'burnt-pizzas';
export const ROUTING_KEY = 'order';
export const DLQ_ROUTING_KEY = 'burnt';
