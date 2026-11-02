CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE orders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  cart_id    text NOT NULL UNIQUE,  -- idempotency key: one order per checked-out cart
  status     text NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'paid', 'packed', 'shipped', 'cancelled')),
  total      integer NOT NULL CHECK (total >= 0),
  currency   text NOT NULL,
  placed_at  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_id_idx ON orders (user_id, placed_at DESC);
