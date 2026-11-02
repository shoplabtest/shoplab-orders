import amqp from 'amqplib';

export const EXCHANGE = 'shop.events';

export interface OrderLineEvent { productId: string; quantity: number; unitPrice: number | null }

/** Matches shoplab-contracts events/order.placed.schema.json. */
export interface OrderPlaced {
  orderId: string;
  userId: string;
  total: number;
  currency: string;
  lines: OrderLineEvent[];
  placedAt: string;
}

/** Matches events/order.cancelled.schema.json. */
export interface OrderCancelled { orderId: string; userId: string; reason?: string; cancelledAt: string }

/** Events this service reads. See events/cart.checked_out, payment.captured and payment.failed schemas. */
export interface CartCheckedOut {
  cartId: string;
  userId: string;
  total: number;
  currency: string;
  lines: { productId: string; quantity: number }[];
}
export interface PaymentCaptured { paymentId: string; orderId: string; amount: number; currency: string; capturedAt: string }
export interface PaymentFailed { paymentId: string; orderId: string; reason?: string; failedAt: string }

export interface Publisher {
  publish(routingKey: 'order.placed', body: OrderPlaced): Promise<void>;
  publish(routingKey: 'order.cancelled', body: OrderCancelled): Promise<void>;
  close(): Promise<void>;
}

export class NullPublisher implements Publisher {
  published: { key: string; body: unknown }[] = [];
  async publish(key: string, body: unknown) { this.published.push({ key, body }); }
  async close() {}
}

export async function connectPublisher(url: string): Promise<Publisher> {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  return {
    async publish(key: string, body: unknown) {
      ch.publish(EXCHANGE, key, Buffer.from(JSON.stringify(body)), { contentType: 'application/json', persistent: true });
    },
    async close() {
      await ch.close();
      await conn.close();
    },
  } as Publisher;
}
