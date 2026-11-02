import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, seedOrders, seedUserId } from '../src/seed.ts';
import { MemoryStore } from '../src/store.ts';

test('seed is deterministic: 100 orders with unique cart ids and consistent totals', () => {
  assert.deepEqual(seedOrders(), seedOrders());
  const orders = seedOrders();
  assert.equal(orders.length, 100);
  assert.equal(new Set(orders.map((o) => o.cartId)).size, 100);
  for (const o of orders) assert.equal(o.total, o.lines.reduce((n, l) => n + l.quantity * l.unit_price, 0));
});

test('seed user ids are stable, valid uuids', () => {
  assert.equal(seedUserId(3), seedUserId(3));
  assert.notEqual(seedUserId(3), seedUserId(4));
  assert.match(seedUserId(0), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('seeding creates 100 orders across statuses, and a second run creates none', async () => {
  const store = new MemoryStore();
  assert.equal(await seed(store), 100);
  assert.equal(await seed(store), 0);
  const statuses = new Set([...store.orders.values()].map((o) => o.status));
  assert.ok(statuses.has('placed') && statuses.has('shipped') && statuses.has('cancelled'), [...statuses].join());
});
