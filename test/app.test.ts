import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { placeFromCheckout } from '../src/orders.ts';
import { OTHER, USER, cfg, checkout, fresh, token } from './helpers.ts';

const deps = fresh();
const server = createApp({ cfg, ...deps }).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

const call = (path: string, o: { method?: string; body?: unknown; token?: string } = {}) =>
  fetch(base + path, {
    method: o.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });

type Order = { id: string; status: string; total: number; currency: string; placedAt: string; userId?: string; lines?: { productId: string; quantity: number; unitPrice: number | null }[] };

beforeEach(() => {
  deps.store.orders.clear();
  deps.store.lines.clear();
  deps.store.hist.clear();
  deps.events.published.length = 0;
});

const place = async (cartId = 'cart-1', userId = USER) => (await placeFromCheckout(deps, checkout(cartId, userId)))!.order.id;

test('every route needs a token', async () => {
  const id = await place();
  for (const [method, path] of [['GET', '/orders'], ['GET', `/orders/${id}`], ['POST', `/orders/${id}/cancel`], ['POST', `/orders/${id}/pack`], ['POST', `/orders/${id}/ship`]]) {
    assert.equal((await call(path, { method })).status, 401, `${method} ${path}`);
  }
  assert.equal((await call('/orders', { token: 'garbage' })).status, 401);
});

test('GET /orders lists only the caller\'s orders, newest first, in the contract shape', async () => {
  const first = await place('cart-1');
  const second = await place('cart-2');
  await place('cart-3', OTHER);
  const list = (await (await call('/orders', { token: token(USER) })).json()) as Order[];
  assert.deepEqual(list.map((o) => o.id), [second, first]);
  assert.deepEqual(Object.keys(list[0]).sort(), ['currency', 'id', 'placedAt', 'status', 'total']);
  assert.equal(list[0].status, 'placed');
});

test('GET /orders/:id returns lines; other customers get 403, staff may read, unknown ids are 404', async () => {
  const id = await place();
  const mine = (await (await call(`/orders/${id}`, { token: token(USER) })).json()) as Order;
  assert.equal(mine.userId, USER);
  assert.deepEqual(mine.lines, [{ productId: 'p-1', quantity: 2, unitPrice: 1000 }, { productId: 'p-2', quantity: 1, unitPrice: 250 }]);
  assert.equal((await call(`/orders/${id}`, { token: token(OTHER) })).status, 403);
  assert.equal((await call(`/orders/${id}`, { token: token(OTHER, 'staff') })).status, 200);
  assert.equal((await call('/orders/00000000-0000-0000-0000-000000000000', { token: token(USER) })).status, 404);
  assert.equal((await call('/orders/not-a-uuid', { token: token(USER) })).status, 404);
});

test('the owner can cancel; the event is published; a second cancel is 409', async () => {
  const id = await place();
  const r = await call(`/orders/${id}/cancel`, { method: 'POST', body: { reason: 'too slow' }, token: token(USER) });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as Order).status, 'cancelled');
  assert.equal(deps.events.published.at(-1)?.key, 'order.cancelled');
  const again = await call(`/orders/${id}/cancel`, { method: 'POST', token: token(USER) });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'invalid_transition', from: 'cancelled', to: 'cancelled' });
});

test('another customer cannot cancel someone else\'s order', async () => {
  const id = await place();
  assert.equal((await call(`/orders/${id}/cancel`, { method: 'POST', token: token(OTHER) })).status, 403);
  assert.equal((await deps.store.getOrder(id))?.status, 'placed');
});

test('pack and ship are staff-only and follow the state machine', async () => {
  const id = await place();
  assert.equal((await call(`/orders/${id}/pack`, { method: 'POST', token: token(USER) })).status, 403);
  const early = await call(`/orders/${id}/pack`, { method: 'POST', token: token('s1', 'staff') });
  assert.equal(early.status, 409, 'an unpaid order cannot be packed');
  await deps.store.transition(id, 'paid');
  assert.equal(((await (await call(`/orders/${id}/pack`, { method: 'POST', token: token('s1', 'staff') })).json()) as Order).status, 'packed');
  assert.equal(((await (await call(`/orders/${id}/ship`, { method: 'POST', token: token('s1', 'admin') })).json()) as Order).status, 'shipped');
  assert.equal((await call(`/orders/${id}/cancel`, { method: 'POST', token: token(USER) })).status, 409, 'shipped orders cannot be cancelled');
});

test('healthz needs no token', async () => {
  assert.equal((await call('/healthz')).status, 200);
});
