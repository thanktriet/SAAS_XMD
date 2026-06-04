-- =============================================================================
-- Migration: tạo bảng service_tickets — phiếu dịch vụ DMS với QR SEPay
--   Workflow: nhập mã DMS + số tiền → sinh QR → khách quét → webhook đối chiếu
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_tickets (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã phiếu dịch vụ (auto-gen DV2026XXXXX)
  ticket_code     TEXT          UNIQUE NOT NULL,

  -- Mã lệnh sửa chữa từ hệ thống DMS VinFast — KTV nhập tay, UNIQUE để tránh trùng
  dms_code        TEXT          UNIQUE NOT NULL,

  -- Thông tin khách hàng (text, không FK — sửa vãng lai)
  customer_name   TEXT,
  customer_phone  TEXT,

  -- Số tiền cần thu (> 0 — yêu cầu nghiệp vụ)
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),

  -- Trạng thái thanh toán
  payment_status  TEXT          NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending', 'paid', 'cancelled')),

  -- Webhook SEPay khi match xong
  sepay_transaction_id    TEXT,
  finance_transaction_id  UUID    REFERENCES finance_transactions(id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,

  -- Ghi chú và metadata
  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Indexes phục vụ truy vấn nhanh
CREATE INDEX IF NOT EXISTS idx_service_tickets_dms        ON service_tickets(dms_code);
CREATE INDEX IF NOT EXISTS idx_service_tickets_status     ON service_tickets(payment_status);
CREATE INDEX IF NOT EXISTS idx_service_tickets_created_at ON service_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_tickets_sepay      ON service_tickets(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_service_tickets_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_tickets_set_updated ON service_tickets;
CREATE TRIGGER trg_service_tickets_set_updated
  BEFORE UPDATE ON service_tickets
  FOR EACH ROW EXECUTE FUNCTION trg_service_tickets_updated_at();

COMMENT ON TABLE service_tickets IS
  'Phiếu dịch vụ — khách trả tiền sửa xe qua QR SEPay. Đối chiếu webhook theo dms_code + amount.';
COMMENT ON COLUMN service_tickets.dms_code IS
  'Mã lệnh sửa chữa từ hệ thống DMS VinFast — UNIQUE.';
COMMENT ON COLUMN service_tickets.payment_status IS
  'pending = chờ khách quét QR, paid = SEPay đã match, cancelled = nhân viên hủy';
