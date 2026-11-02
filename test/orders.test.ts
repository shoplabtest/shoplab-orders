import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPaymentCaptured, applyPaymentFailed, cancelOrder, placeFromCheckout } from '../src/orders.ts';
import { handleMessage } from '../src/consumer.ts';
import { checkout, fresh } from './helpers.ts';

test('a checked-out cart becomes a placed order with catalog prices, and order.placed is published', async () => {
  const deps = fresh();
  const r = await placeFromCheckout(deps, checkout());
  assert.equal(r?.created, true);
  assert.equal(r?.order.status, 'placed');
  assert.deepEqual(await deps.store.getLines(r!.order.id), [
    { product_id: 'p-1', quantity: 2, unit_price: 1000 },
    { product_id: 'p-2', quantity: 1, unit_price: 250 },
  ]);
  const ev = deps.events.published.at(-1)!;
  assert.equal(ev.key, 'order.placed');
  const body = ev.body as { orderId: string; total: number; lines: unknown[]; placedAt: string };
  assert.equal(body.orderId, r!.order.id);
  assert.equal(body.total, 2250);
  assert.equal(body.lines.length, 2);
  assert.ok(!Number.isNaN(Date.parse(body.placedAt)));
});

test('redelivering the same cart creates one order and one event', async () => {
  const deps = fresh();
  const a = await placeFromCheckout(deps, checkout('cart-9'));
  const b = await placeFromCheckout(deps, checkout('cart-9'));
  assert.equal(b?.created, false);
  assert.equal(b?.order.id, a?.order.id);
  assert.equal(deps.store.orders.size, 1);
  assert.equal(deps.events.published.length, 1);
});

test('an unknown product keeps its line with a null unit price', async () => {
  const deps = fresh();
  const r = await placeFromCheckout(deps, { ...checkout(), lines: [{ productId: 'gone', quantity: 1 }] });
  assert.deepEqual(await deps.store.getLines(r!.order.id), [{ product_id: 'gone', quantity: 1, unit_price: null }]);
});

test('malformed checkouts are rejected without creating anything', async () => {
  const deps = fresh();
  for (const bad of [{ ...checkout(), lines: [] }, { ...checkout(), total: 'x' }, { ...checkout(), lines: [{ productId: 'p-1', quantity: 0 }] }, { cartId: 1 }]) {
    assert.equal(await placeFromCheckout(deps, bad as never), null);
  }
  assert.equal(deps.store.orders.size, 0);
  assert.equal(deps.events.published.length, 0);
});

test('payment.captured moves a placed order to paid exactly once', async () => {
  const deps = fresh();
  const { order } = (await placeFromCheckout(deps, checkout()))!;
  const ev = { paymentId: 'pay-1', orderId: order.id, amount: 2250, currency: 'USD', capturedAt: new Date().toISOString() };
  assert.equal((await applyPaymentCaptured(deps, ev))?.status, 'paid');
  assert.equal(await applyPaymentCaptured(deps, ev), null);
  assert.deepEqual((await deps.store.history(order.id)).map((h) => h.to_status), ['placed', 'paid']);
});

test('payment.captured for unknown or cancelled orders is ignored', async () => {
  const deps = fresh();
  const { order } = (await placeFromCheckout(deps, checkout()))!;
  await cancelOrder(deps, order);
  const ev = { paymentId: 'pay-1', orderId: order.id, amount: 1, currency: 'USD', capturedAt: '' };
  assert.equal(await applyPaymentCaptured(deps, ev), null);
  assert.equal(await applyPaymentCaptured(deps, { ...ev, orderId: 'nope' }), null);
  assert.equal((await deps.store.getOrder(order.id))?.status, 'cancelled');
});

test('payment.failed leaves the order placed and records why', async () => {
  const deps = fresh();
  const { order } = (await placeFromCheckout(deps, checkout()))!;
  assert.equal(await applyPaymentFailed(deps, { paymentId: 'pay-2', orderId: order.id, reason: 'card declined', failedAt: '' }), true);
  assert.equal((await deps.store.getOrder(order.id))?.status, 'placed');
  assert.match((await deps.store.history(order.id)).at(-1)!.note!, /card declined/);
  assert.equal(await applyPaymentFailed(deps, { paymentId: 'pay-2', orderId: 'nope', failedAt: '' }), false);
});

test('cancelling publishes order.cancelled with the reason', async () => {
  const deps = fresh();
  const { order } = (await placeFromCheckout(deps, checkout()))!;
  const next = await cancelOrder(deps, order, 'changed my mind');
  assert.equal(next?.status, 'cancelled');
  const ev = deps.events.published.at(-1)!;
  assert.equal(ev.key, 'order.cancelled');
  assert.deepEqual({ ...(ev.body as object), cancelledAt: undefined }, { orderId: order.id, userId: order.user_id, reason: 'changed my mind', cancelledAt: undefined });
  assert.equal(await cancelOrder(deps, order), null, 'a second cancel does nothing');
});

test('handleMessage routes by routing key and rejects bad JSON', async () => {
  const deps = fresh();
  await handleMessage(deps, 'cart.checked_out', JSON.stringify(checkout('cart-m')));
  assert.equal(deps.store.orders.size, 1);
  const id = [...deps.store.orders.keys()][0];
  await handleMessage(deps, 'payment.captured', JSON.stringify({ paymentId: 'p', orderId: id, amount: 1, currency: 'USD', capturedAt: '' }));
  assert.equal(deps.store.orders.get(id)?.status, 'paid');
  await handleMessage(deps, 'something.else', '{}');
  await assert.rejects(handleMessage(deps, 'cart.checked_out', 'not json'));
});
