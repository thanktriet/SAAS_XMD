-- =============================================================================
-- Migration: Phiếu chi tiền mặt — ứng tiền cho dịch vụ đăng ký
--   Workflow: pending → approved → completed → reconciled
--   Liên kết đơn xe (optional) hoặc độc lập
-- =============================================================================

CREATE TABLE IF NOT EXISTS cash_advances (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã phiếu auto-gen: PC2026XXXXX
  advance_code    TEXT          UNIQUE NOT NULL,

  -- Mục đích chi (vd "Đăng ký biển số xe DH202600001")
  purpose         TEXT          NOT NULL,

  -- Số tiền yêu cầu ứng (NV nhập)
  amount_requested NUMERIC(15,2) NOT NULL CHECK (amount_requested > 0),

  -- Liên kết đơn xe (nullable — phiếu độc lập = NULL)
  sales_order_id  UUID          REFERENCES sales_orders(id) ON DELETE SET NULL,

  -- Trạng thái lifecycle
  status          TEXT          NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'reconciled', 'cancelled')),

  -- Người tạo phiếu
  requested_by    UUID          REFERENCES users(id) ON DELETE SET NULL,

  -- Người duyệt (manager/admin)
  approved_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,

  -- Khi NV mang biên lai về (status = completed)
  amount_actual   NUMERIC(15,2),                          -- số thực chi
  receipt_number  TEXT,                                   -- số biên lai
  receipt_date    DATE,
  receipt_image_url TEXT,                                 -- ảnh biên lai (tùy chọn)
  completed_at    TIMESTAMPTZ,

  -- Khi kế toán đối chiếu (status = reconciled)
  reconciled_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at   TIMESTAMPTZ,
  finance_transaction_id UUID   REFERENCES finance_transactions(id) ON DELETE SET NULL,

  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_advances_status
  ON cash_advances(status);
CREATE INDEX IF NOT EXISTS idx_cash_advances_sales_order
  ON cash_advances(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_advances_requested_by
  ON cash_advances(requested_by);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_cash_advances_upd() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_advances_set_upd ON cash_advances;
CREATE TRIGGER trg_cash_advances_set_upd
  BEFORE UPDATE ON cash_advances
  FOR EACH ROW EXECUTE FUNCTION trg_cash_advances_upd();

COMMENT ON TABLE cash_advances IS
  'Phiếu chi tiền mặt — đại lý ứng tiền cho NV đi làm dịch vụ đăng ký, sau đó đối chiếu lại.';
COMMENT ON COLUMN cash_advances.status IS
  'pending: chờ duyệt | approved: đã duyệt + giao tiền | rejected: từ chối | completed: NV mang biên lai về | reconciled: kế toán đối chiếu xong | cancelled: hủy';
