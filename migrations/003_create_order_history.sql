CREATE TABLE order_history (
  id         bigserial PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text,
  to_status  text NOT NULL,
  note       text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_history_order_idx ON order_history (order_id, id);
