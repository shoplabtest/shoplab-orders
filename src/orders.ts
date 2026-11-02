import type { CatalogClient } from './clients/catalog.ts';
import type { CartCheckedOut, OrderCancelled, PaymentCaptured, PaymentFailed, Publisher } from './events.ts';
import type { OrderRow, Store } from './store.ts';

export interface Deps { store: Store; events: Publisher; catalog: CatalogClient }

const isInt = (n: unknown): n is number => Number.isInteger(n);

/** Creates the order for a checked-out cart. Redelivered events are harmless: only the first one creates and announces the order. */
export async function placeFromCheckout({ store, events, catalog }: Deps, ev: CartCheckedOut): Promise<{ order: OrderRow; created: boolean } | null> {
  const valid =
    typeof ev.cartId === 'string' && typeof ev.userId === 'string' && isInt(ev.total) && ev.total >= 0 && typeof ev.currency === 'string' &&
    Array.isArray(ev.lines) && ev.lines.length > 0 && ev.lines.every((l) => typeof l.productId === 'string' && isInt(l.quantity) && l.quantity > 0);
  if (!valid) return null;

  const lines = await Promise.all(ev.lines.map(async (l) => ({ product_id: l.productId, quantity: l.quantity, unit_price: await catalog.unitPrice(l.productId) })));
  const result = await store.createFromCheckout({ cartId: ev.cartId, userId: ev.userId, total: ev.total, currency: ev.currency, lines });
  if (result.created) {
    await events.publish('order.placed', {
      orderId: result.order.id,
      userId: result.order.user_id,
      total: result.order.total,
      currency: result.order.currency,
      lines: lines.map((l) => ({ productId: l.product_id, quantity: l.quantity, unitPrice: l.unit_price })),
      placedAt: result.order.placed_at.toISOString(),
    });
  }
  return result;
}

/** A captured payment moves a placed order to paid. Anything else (unknown, already paid, cancelled) is ignored. */
export async function applyPaymentCaptured({ store }: Deps, ev: PaymentCaptured): Promise<OrderRow | null> {
  if (typeof ev.orderId !== 'string') return null;
  const order = await store.getOrder(ev.orderId);
  if (!order || order.status !== 'placed') return null;
  return store.transition(order.id, 'paid', `payment ${ev.paymentId} captured`);
}

/** A failed payment is recorded in the order history; the order stays placed so the customer can retry. */
export async function applyPaymentFailed({ store }: Deps, ev: PaymentFailed): Promise<boolean> {
  if (typeof ev.orderId !== 'string' || !(await store.getOrder(ev.orderId))) return false;
  await store.addNote(ev.orderId, `payment ${ev.paymentId} failed${ev.reason ? `: ${ev.reason}` : ''}`);
  return true;
}

export async function cancelOrder({ store, events }: Deps, order: OrderRow, reason?: string): Promise<OrderRow | null> {
  const next = await store.transition(order.id, 'cancelled', reason);
  if (!next) return null;
  const body: OrderCancelled = { orderId: next.id, userId: next.user_id, ...(reason ? { reason } : {}), cancelledAt: next.updated_at.toISOString() };
  await events.publish('order.cancelled', body);
  return next;
}
