-- sales_order_attachments table
CREATE TABLE IF NOT EXISTS sales_order_attachments (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  file_name    TEXT        NOT NULL,
  stored_name  TEXT        NOT NULL,
  mime_type    TEXT,
  size_bytes   INTEGER,
  uploaded_by  UUID        REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_order ON sales_order_attachments(order_id);
