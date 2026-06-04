-- =============================================================================
-- Migration: Đơn bán phụ kiện độc lập + thu tiền mặt cho phiếu DV
--   1. Bảng accessory_orders + accessory_order_items
--   2. Thêm payment_method cho service_tickets (cash | qr_sepay)
-- =============================================================================

-- ── 1. Đơn bán phụ kiện ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accessory_orders (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã đơn auto-gen: PK2026XXXXX
  order_code      TEXT          UNIQUE NOT NULL,

  -- KH bắt buộc (để tích điểm)
  customer_id     UUID          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name   TEXT,         -- cache
  customer_phone  TEXT,         -- cache

  -- Tổng tiền
  subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Thanh toán
  payment_method  TEXT          NOT NULL CHECK (payment_method IN ('qr_sepay', 'cash')),
  payment_status  TEXT          NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending', 'paid', 'cancelled')),

  -- Webhook + finance link
  sepay_transaction_id    TEXT,
  finance_transaction_id  UUID    REFERENCES finance_transactions(id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,
  paid_by                 UUID    REFERENCES users(id) ON DELETE SET NULL,

  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accessory_orders_status
  ON accessory_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_accessory_orders_customer
  ON accessory_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_accessory_orders_created_at
  ON accessory_orders(created_at DESC);

-- Chi tiết đơn — phụ kiện trong đơn
CREATE TABLE IF NOT EXISTS accessory_order_items (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID          NOT NULL REFERENCES accessory_orders(id) ON DELETE CASCADE,
  accessory_id  UUID          NOT NULL REFERENCES accessories(id),
  quantity      INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(15,2) NOT NULL,
  line_total    NUMERIC(15,2) NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accessory_order_items_order
  ON accessory_order_items(order_id);

-- Trigger updated_at cho accessory_orders
CREATE OR REPLACE FUNCTION trg_accessory_orders_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accessory_orders_set_updated ON accessory_orders;
CREATE TRIGGER trg_accessory_orders_set_updated
  BEFORE UPDATE ON accessory_orders
  FOR EACH ROW EXECUTE FUNCTION trg_accessory_orders_updated_at();

COMMENT ON TABLE accessory_orders IS
  'Đơn bán phụ kiện rời (không liên quan bán xe). Khi paid → giảm tồn kho qua item_movements + cộng điểm.';

-- ── 2. Phiếu DV — thêm payment_method ────────────────────────────────────────
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IN ('qr_sepay', 'cash'))
    DEFAULT 'qr_sepay';

ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN service_tickets.payment_method IS
  'qr_sepay = chờ webhook tự match; cash = nhân viên xác nhận tay (kế toán/manager/admin)';
COMMENT ON COLUMN service_tickets.paid_by IS
  'User xác nhận thu tiền mặt (NULL nếu thanh toán qua QR webhook)';
