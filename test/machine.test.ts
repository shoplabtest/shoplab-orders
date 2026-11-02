import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES, canTransition, sourcesFor } from '../src/machine.ts';

test('the happy path is placed, paid, packed, shipped', () => {
  assert.ok(canTransition('placed', 'paid'));
  assert.ok(canTransition('paid', 'packed'));
  assert.ok(canTransition('packed', 'shipped'));
});

test('orders can be cancelled until they ship', () => {
  for (const s of ['placed', 'paid', 'packed'] as const) assert.ok(canTransition(s, 'cancelled'), s);
  assert.ok(!canTransition('shipped', 'cancelled'));
});

test('shipped and cancelled are final', () => {
  for (const to of STATUSES) {
    assert.ok(!canTransition('shipped', to));
    assert.ok(!canTransition('cancelled', to));
  }
});

test('no skipping: placed cannot go straight to packed or shipped, and nothing moves backwards', () => {
  assert.ok(!canTransition('placed', 'packed'));
  assert.ok(!canTransition('placed', 'shipped'));
  assert.ok(!canTransition('paid', 'placed'));
  assert.ok(!canTransition('packed', 'paid'));
});

test('sourcesFor lists where an order may come from', () => {
  assert.deepEqual(sourcesFor('paid'), ['placed']);
  assert.deepEqual(sourcesFor('cancelled'), ['placed', 'paid', 'packed']);
});
