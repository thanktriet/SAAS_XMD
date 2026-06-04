-- =============================================================================
-- Migration: hoàn thiện service_tickets + cấu hình tích điểm
--   1. Thêm customer_id (bắt buộc) vào service_tickets
--   2. Thêm key cấu hình loyalty_amount_per_point vào payment_settings
-- =============================================================================

-- ── 1. service_tickets gắn KH ──────────────────────────────────────────────
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_tickets_customer
  ON service_tickets(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN service_tickets.customer_id IS
  'KH gắn với phiếu DV (tích điểm khi paid). NULL = phiếu cũ trước khi migrate.';

-- ── 2. Cấu hình tỷ lệ tích điểm ────────────────────────────────────────────
-- payment_settings dùng (key, value) — thêm khóa mới với giá trị mặc định
INSERT INTO payment_settings (key, value, label)
VALUES
  ('loyalty_amount_per_point', '10000', 'Số tiền (VNĐ) ứng với 1 điểm tích lũy'),
  ('loyalty_enabled',           'true',  'Bật/tắt tích điểm khi KH chi tiêu')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE payment_settings IS
  'Cấu hình thanh toán + tích điểm. loyalty_amount_per_point: 10000 = 1 điểm cho mỗi 10k chi tiêu';
