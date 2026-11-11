import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Config } from './config.ts';
import { canTransition, type Status } from './machine.ts';
import { cancelOrder, type Deps as OrderDeps } from './orders.ts';
import type { OrderRow } from './store.ts';

interface Claims { sub: string; role: 'customer' | 'staff' | 'admin'; tenant: string }

declare module 'express-serve-static-core' {
  interface Request { claims?: Claims }
}

/** Response shapes from shoplab-contracts openapi/orders.yaml. */
/** `cartId` is the cart the order was created from; the checkout UI uses it to find its own order after the asynchronous checkout. */
const toSummary = (o: OrderRow) => ({ id: o.id, cartId: o.cart_id, status: o.status, total: o.total, currency: o.currency, placedAt: o.placed_at.toISOString() });

export interface AppDeps extends OrderDeps { cfg: Config }

export function createApp(deps: AppDeps) {
  const { cfg, store } = deps;
  const app = express();
  app.use(express.json());

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const h = req.header('authorization');
    if (!h?.startsWith('Bearer ')) return void res.status(401).json({ error: 'unauthorized' });
    try {
      req.claims = jwt.verify(h.slice(7), cfg.jwtSecret) as Claims;
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  };
  const requireStaff = (req: Request, res: Response, next: NextFunction) =>
    req.claims!.role === 'customer' ? void res.status(403).json({ error: 'forbidden' }) : next();

  const toOrder = async (o: OrderRow) => ({
    ...toSummary(o),
    userId: o.user_id,
    lines: (await store.getLines(o.id)).map((l) => ({ productId: l.product_id, quantity: l.quantity, unitPrice: l.unit_price })),
  });

  /** Loads the order and checks the caller owns it or is staff. Sends the error response itself and returns null. */
  const loadVisible = async (req: Request, res: Response): Promise<OrderRow | null> => {
    const order = await store.getOrder(req.params.id).catch(() => null);
    if (!order) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    if (order.user_id !== req.claims!.sub && req.claims!.role === 'customer') {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
    return order;
  };

  const move = (to: Status) => async (req: Request, res: Response) => {
    const order = await loadVisible(req, res);
    if (!order) return;
    const next = await store.transition(order.id, to);
    if (!next) return void res.status(409).json({ error: 'invalid_transition', from: order.status, to });
    res.json(await toOrder(next));
  };

  app.get('/healthz', (_req, res) => void res.json({ ok: true }));

  app.get('/orders', requireAuth, async (req, res) => res.json((await store.listForUser(req.claims!.sub)).map(toSummary)));

  app.get('/orders/:id', requireAuth, async (req, res) => {
    const order = await loadVisible(req, res);
    if (order) res.json(await toOrder(order));
  });

  app.post('/orders/:id/cancel', requireAuth, async (req, res) => {
    const order = await loadVisible(req, res);
    if (!order) return;
    if (!canTransition(order.status, 'cancelled')) return void res.status(409).json({ error: 'invalid_transition', from: order.status, to: 'cancelled' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const next = await cancelOrder(deps, order, reason);
    if (!next) return void res.status(409).json({ error: 'invalid_transition', from: order.status, to: 'cancelled' });
    res.json(await toOrder(next));
  });

  app.post('/orders/:id/pack', requireAuth, requireStaff, move('packed'));
  app.post('/orders/:id/ship', requireAuth, requireStaff, move('shipped'));

  return app;
}
