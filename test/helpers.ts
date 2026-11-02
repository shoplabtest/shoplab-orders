import jwt from 'jsonwebtoken';
import { loadConfig } from '../src/config.ts';
import type { CatalogClient } from '../src/clients/catalog.ts';
import { NullPublisher } from '../src/events.ts';
import { MemoryStore } from '../src/store.ts';

export const cfg = loadConfig({ JWT_SECRET: 'test-secret' } as NodeJS.ProcessEnv);

export class FakeCatalog implements CatalogClient {
  prices = new Map<string, number>([['p-1', 1000], ['p-2', 250]]);
  async unitPrice(id: string) { return this.prices.get(id) ?? null; }
}

export const token = (sub: string, role = 'customer') => jwt.sign({ sub, role, tenant: 'default' }, cfg.jwtSecret);

export const fresh = () => ({ store: new MemoryStore(), events: new NullPublisher(), catalog: new FakeCatalog() });

export const USER = '11111111-1111-1111-1111-111111111111';
export const OTHER = '22222222-2222-2222-2222-222222222222';

export const checkout = (cartId = 'cart-1', userId = USER) => ({
  cartId, userId, total: 2250, currency: 'USD', lines: [{ productId: 'p-1', quantity: 2 }, { productId: 'p-2', quantity: 1 }],
});
