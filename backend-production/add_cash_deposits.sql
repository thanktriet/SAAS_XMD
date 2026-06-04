-- =============================================================================
-- Migration: Phiếu nộp tiền mặt về tài khoản công ty
--   Workflow đơn giản: tạo phiếu → ghi finance_transaction (expense cash) ngay
--   → quỹ tiền mặt giảm tự động
-- =============================================================================

CREATE TABLE IF NOT EXISTS cash_deposits (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã phiếu auto-gen: NT2026XXXXX (Nộp Tiền)
  deposit_code    TEXT          UNIQUE NOT NULL,

  -- Số tiền nộp
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),

  -- Tài khoản ngân hàng nhận
  bank_name       TEXT          NOT NULL,
  bank_account    TEXT          NOT NULL,
  bank_account_name TEXT,

  -- Ngày nộp + biên lai
  deposit_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  receipt_number  TEXT,                      -- số biên lai từ ngân hàng (nếu có)
  receipt_image_url TEXT,                    -- ảnh biên lai

  -- Liên kết finance — phiếu này tạo 1 expense cash giảm quỹ
  finance_transaction_id UUID   REFERENCES finance_transactions(id) ON DELETE SET NULL,

  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_deposits_date ON cash_deposits(deposit_date DESC);

CREATE OR REPLACE FUNCTION trg_cash_deposits_upd() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_deposits_set_upd ON cash_deposits;
CREATE TRIGGER trg_cash_deposits_set_upd
  BEFORE UPDATE ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION trg_cash_deposits_upd();

COMMENT ON TABLE cash_deposits IS
  'Phiếu nộp tiền mặt từ quỹ về tài khoản ngân hàng công ty. Mỗi phiếu = 1 expense cash trong finance_transactions, giảm quỹ tiền mặt.';
