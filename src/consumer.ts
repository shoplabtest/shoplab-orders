import amqp from 'amqplib';
import { EXCHANGE, type CartCheckedOut, type PaymentCaptured, type PaymentFailed } from './events.ts';
import { applyPaymentCaptured, applyPaymentFailed, placeFromCheckout, type Deps } from './orders.ts';

export const QUEUE = 'orders.events';
export const BINDINGS = ['cart.checked_out', 'payment.captured', 'payment.failed'] as const;

/** Routes one message to its handler. Throws on malformed JSON so the caller can reject it. */
export async function handleMessage(deps: Deps, routingKey: string, raw: string): Promise<void> {
  const body = JSON.parse(raw) as unknown;
  if (routingKey === 'cart.checked_out') await placeFromCheckout(deps, body as CartCheckedOut);
  else if (routingKey === 'payment.captured') await applyPaymentCaptured(deps, body as PaymentCaptured);
  else if (routingKey === 'payment.failed') await applyPaymentFailed(deps, body as PaymentFailed);
}

export async function startConsumer(url: string, deps: Deps) {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  for (const key of BINDINGS) await ch.bindQueue(QUEUE, EXCHANGE, key);
  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      await handleMessage(deps, msg.fields.routingKey, msg.content.toString());
      ch.ack(msg);
    } catch {
      ch.nack(msg, false, false);
    }
  });
  return async () => { await ch.close(); await conn.close(); };
}
