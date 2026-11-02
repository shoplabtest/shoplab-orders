import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canTransition, type Status } from './machine.ts';

export interface OrderRow {
  id: string;
  user_id: string;
  cart_id: string;
  status: Status;
  total: number;
  currency: string;
  placed_at: Date;
  updated_at: Date;
}

export interface LineRow { product_id: string; quantity: number; unit_price: number | null }

export interface HistoryRow { from_status: Status | null; to_status: Status; note: string | null }

export interface NewOrder { cartId: string; userId: string; total: number; currency: string; lines: LineRow[] }

export interface Store {
  /** Idempotent on cartId: a second call for the same cart returns the existing order with created=false. */
  createFromCheckout(o: NewOrder): Promise<{ order: OrderRow; created: boolean }>;
  getOrder(id: string): Promise<OrderRow | null>;
  getLines(orderId: string): Promise<LineRow[]>;
  listForUser(userId: string): Promise<OrderRow[]>;
  /** Moves the order only when the state machine allows it from its current status; null when missing or not allowed. */
  transition(id: string, to: Status, note?: string): Promise<OrderRow | null>;
  addNote(id: string, note: string): Promise<void>;
  history(id: string): Promise<HistoryRow[]>;
}

export class PgStore implements Store {
  constructor(private pool: Pool) {}

  async createFromCheckout(o: NewOrder) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query<OrderRow>(
        `INSERT INTO orders (user_id, cart_id, total, currency) VALUES ($1, $2, $3, $4)
         ON CONFLICT (cart_id) DO NOTHING RETURNING *`,
        [o.userId, o.cartId, o.total, o.currency],
      );
      if (!ins.rows[0]) {
        await client.query('ROLLBACK');
        return { order: (await this.pool.query<OrderRow>('SELECT * FROM orders WHERE cart_id = $1', [o.cartId])).rows[0], created: false };
      }
      const order = ins.rows[0];
      for (const l of o.lines) {
        await client.query('INSERT INTO order_lines (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)', [order.id, l.product_id, l.quantity, l.unit_price]);
      }
      await client.query("INSERT INTO order_history (order_id, from_status, to_status) VALUES ($1, NULL, 'placed')", [order.id]);
      await client.query('COMMIT');
      return { order, created: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async getOrder(id: string) {
    return (await this.pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id])).rows[0] ?? null;
  }
  async getLines(orderId: string) {
    return (await this.pool.query<LineRow>('SELECT product_id, quantity, unit_price FROM order_lines WHERE order_id = $1 ORDER BY product_id', [orderId])).rows;
  }
  async listForUser(userId: string) {
    return (await this.pool.query<OrderRow>('SELECT * FROM orders WHERE user_id = $1 ORDER BY placed_at DESC, id', [userId])).rows;
  }
  async transition(id: string, to: Status, note?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur || !canTransition(cur.status, to)) {
        await client.query('ROLLBACK');
        return null;
      }
      const next = (await client.query<OrderRow>('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, to])).rows[0];
      await client.query('INSERT INTO order_history (order_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)', [id, cur.status, to, note ?? null]);
      await client.query('COMMIT');
      return next;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async addNote(id: string, note: string) {
    await this.pool.query('INSERT INTO order_history (order_id, from_status, to_status, note) SELECT id, status, status, $2 FROM orders WHERE id = $1', [id, note]);
  }
  async history(id: string) {
    return (await this.pool.query<HistoryRow>('SELECT from_status, to_status, note FROM order_history WHERE order_id = $1 ORDER BY id', [id])).rows;
  }
}

/** In-memory store for unit tests. Returns copies, like a database. */
export class MemoryStore implements Store {
  orders = new Map<string, OrderRow>();
  lines = new Map<string, LineRow[]>();
  hist = new Map<string, HistoryRow[]>();
  private tick = 0;

  async createFromCheckout(o: NewOrder) {
    const existing = [...this.orders.values()].find((x) => x.cart_id === o.cartId);
    if (existing) return { order: { ...existing }, created: false };
    const now = new Date(Date.now() + this.tick++);
    const order: OrderRow = { id: randomUUID(), user_id: o.userId, cart_id: o.cartId, status: 'placed', total: o.total, currency: o.currency, placed_at: now, updated_at: now };
    this.orders.set(order.id, order);
    this.lines.set(order.id, o.lines.map((l) => ({ ...l })));
    this.hist.set(order.id, [{ from_status: null, to_status: 'placed', note: null }]);
    return { order: { ...order }, created: true };
  }
  async getOrder(id: string) { const o = this.orders.get(id); return o ? { ...o } : null; }
  async getLines(orderId: string) { return (this.lines.get(orderId) ?? []).map((l) => ({ ...l })).sort((a, b) => a.product_id.localeCompare(b.product_id)); }
  async listForUser(userId: string) {
    return [...this.orders.values()].filter((o) => o.user_id === userId).sort((a, b) => b.placed_at.getTime() - a.placed_at.getTime()).map((o) => ({ ...o }));
  }
  async transition(id: string, to: Status, note?: string) {
    const o = this.orders.get(id);
    if (!o || !canTransition(o.status, to)) return null;
    this.hist.get(id)!.push({ from_status: o.status, to_status: to, note: note ?? null });
    o.status = to;
    o.updated_at = new Date();
    return { ...o };
  }
  async addNote(id: string, note: string) {
    const o = this.orders.get(id);
    if (o) this.hist.get(id)!.push({ from_status: o.status, to_status: o.status, note });
  }
  async history(id: string) { return (this.hist.get(id) ?? []).map((h) => ({ ...h })); }
}
