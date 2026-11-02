CREATE TABLE order_lines (
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price integer CHECK (unit_price >= 0),  -- null when the catalog lookup failed at placement
  PRIMARY KEY (order_id, product_id)
);
