import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from './config.ts';
import { migrate } from './migrate.ts';
import type { Status } from './machine.ts';
import { PgStore, type Store } from './store.ts';

/** Deterministic PRNG so every environment gets the same 100 orders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable user id for the i-th seed shopper. These are not the ids iam generates; the services do not share a database. */
export const seedUserId = (i: number) => {
  const h = createHash('sha1').update(`shoplab-seed-user-${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const PATHS: Record<Status, Status[]> = {
  placed: [],
  paid: ['paid'],
  packed: ['paid', 'packed'],
  shipped: ['paid', 'packed', 'shipped'],
  cancelled: ['cancelled'],
};
const FINAL: Status[] = ['placed', 'paid', 'packed', 'shipped', 'shipped', 'shipped', 'cancelled'];

export function seedOrders(count = 100, seed = 11) {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, j) => ({
      product_id: `p-seed${String(1 + ((i * 7 + j * 13) % 200)).padStart(3, '0')}`,
      quantity: 1 + Math.floor(rnd() * 3),
      unit_price: 500 + Math.floor(rnd() * 19500),
    }));
    return {
      cartId: `seed-cart-${String(i + 1).padStart(3, '0')}`,
      userId: seedUserId(Math.floor(rnd() * 50)),
      currency: 'USD',
      total: lines.reduce((n, l) => n + l.quantity * l.unit_price, 0),
      lines,
      finalStatus: FINAL[Math.floor(rnd() * FINAL.length)],
    };
  });
}

export async function seed(store: Store) {
  let created = 0;
  for (const o of seedOrders()) {
    const { order, created: isNew } = await store.createFromCheckout(o);
    if (!isNew) continue;
    created++;
    for (const step of PATHS[o.finalStatus]) await store.transition(order.id, step, 'seed');
  }
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  await migrate(pool, resolve(import.meta.dirname, '../migrations'));
  console.log(`seeded ${await seed(new PgStore(pool))} orders`);
  await pool.end();
}
