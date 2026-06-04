-- ============================================================
-- MIGRATION: add_sales_order_payments
-- Hệ thống thanh toán nhiều lần cho đơn hàng
-- Chạy trong Supabase SQL Editor
-- ============================================================

-- ── 1. Bảng sales_order_payments ────────────────────────────
CREATE TABLE IF NOT EXISTS sales_order_payments (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Quan hệ
  order_id                UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  finance_transaction_id  UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,

  -- Phương thức thanh toán
  payment_method          TEXT NOT NULL
    CHECK (payment_method IN ('cash', 'bank_transfer', 'qr_code')),

  -- Số tiền & ngày
  amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_date            DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Trạng thái: pending = TVBH ghi, confirmed = KT xác nhận
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),

  -- ── Tiền mặt (cash) — kế toán điền khi confirm ──────────
  receipt_number          TEXT,       -- số phiếu thu AMIS

  -- ── Chuyển khoản thủ công (bank_transfer) ────────────────
  bank_reference          TEXT,       -- số bút toán NH — kế toán điền
  transfer_screenshot_url TEXT,       -- URL ảnh CK — TVBH upload

  -- ── QR Code / SEPay (qr_code) — tự động ─────────────────
  sepay_transaction_id    TEXT,       -- data.id từ SEPay webhook

  -- Ghi chú
  notes                   TEXT,

  -- Audit
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sop_order_id
  ON sales_order_payments(order_id);

CREATE INDEX IF NOT EXISTS idx_sop_status
  ON sales_order_payments(status);

CREATE INDEX IF NOT EXISTS idx_sop_payment_method
  ON sales_order_payments(payment_method);

-- Mỗi sepay_transaction_id chỉ được ghi nhận 1 lần (chống duplicate webhook)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sop_sepay_unique
  ON sales_order_payments(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;

-- Số phiếu thu không được trùng (trong cùng toàn hệ thống)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sop_receipt_unique
  ON sales_order_payments(receipt_number)
  WHERE receipt_number IS NOT NULL AND status != 'cancelled';

-- ── 3. Trigger updated_at ────────────────────────────────────
DROP TRIGGER IF EXISTS trg_updated_at ON sales_order_payments;
CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON sales_order_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. RLS ───────────────────────────────────────────────────
ALTER TABLE sales_order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read sop"   ON sales_order_payments;
DROP POLICY IF EXISTS "Allow authenticated insert sop" ON sales_order_payments;
DROP POLICY IF EXISTS "Allow authenticated update sop" ON sales_order_payments;

CREATE POLICY "Allow authenticated read sop"
  ON sales_order_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert sop"
  ON sales_order_payments FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update sop"
  ON sales_order_payments FOR UPDATE TO authenticated USING (true);

-- ── 5. Supabase Storage bucket (chạy riêng trong Dashboard nếu cần) ──
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'payment-screenshots',
--   'payment-screenshots',
--   true,
--   5242880,
--   ARRAY['image/jpeg','image/png','image/webp']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- ── 6. View tính tổng thanh toán theo đơn ────────────────────
CREATE OR REPLACE VIEW v_order_payment_summary AS
SELECT
  o.id                                                  AS order_id,
  o.order_number,
  o.total_amount,
  COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0) AS total_paid,
  COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'),   0) AS total_pending,
  o.total_amount
    - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0) AS remaining
FROM sales_orders o
LEFT JOIN sales_order_payments p ON p.order_id = o.id
GROUP BY o.id, o.order_number, o.total_amount;

-- ── XONG ─────────────────────────────────────────────────────
