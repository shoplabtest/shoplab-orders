import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { PgStore } from '../src/store.ts';

// Runs against a real, empty Postgres. CI provides TEST_DATABASE_URL; locally the test is skipped.
const url = process.env.TEST_DATABASE_URL;

test('migrations apply to an empty database and PgStore handles a full order lifecycle', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = resolve(import.meta.dirname, '../migrations');
    assert.equal((await migrate(pool, dir)).length, 3);
    assert.deepEqual(await migrate(pool, dir), []);

    const store = new PgStore(pool);
    const user = '11111111-1111-1111-1111-111111111111';
    const o = { cartId: 'c-1', userId: user, total: 3000, currency: 'USD', lines: [{ product_id: 'p-1', quantity: 3, unit_price: 1000 }, { product_id: 'p-2', quantity: 1, unit_price: null }] };

    const first = await store.createFromCheckout(o);
    assert.equal(first.created, true);
    const again = await store.createFromCheckout(o);
    assert.equal(again.created, false);
    assert.equal(again.order.id, first.order.id);
    assert.deepEqual(await store.getLines(first.order.id), [{ product_id: 'p-1', quantity: 3, unit_price: 1000 }, { product_id: 'p-2', quantity: 1, unit_price: null }]);

    assert.equal(await store.transition(first.order.id, 'packed'), null, 'cannot skip paid');
    assert.equal((await store.transition(first.order.id, 'paid', 'ok'))?.status, 'paid');
    // Two writers make the same move at once: the row lock lets exactly one of them win.
    const race = await Promise.all([store.transition(first.order.id, 'packed'), store.transition(first.order.id, 'packed')]);
    assert.equal(race.filter(Boolean).length, 1);
    assert.equal((await store.getOrder(first.order.id))?.status, 'packed');
    await store.addNote(first.order.id, 'a note');
    const hist = await store.history(first.order.id);
    assert.equal(hist[0].to_status, 'placed');
    assert.equal(hist.at(-1)?.note, 'a note');
    assert.equal((await store.listForUser(user)).length, 1);

    assert.equal(await seed(store), 100);
    assert.equal(await seed(store), 0);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM orders WHERE cart_id LIKE 'seed-cart-%'");
    assert.equal(rows[0].n, 100);
  } finally {
    await pool.end();
  }
});
