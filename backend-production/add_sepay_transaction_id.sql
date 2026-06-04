-- ============================================================
-- add_sepay_transaction_id.sql
-- Thêm 2 cột vào finance_transactions:
--   1. sepay_transaction_id — ID gốc từ SEPay, chống xử lý trùng webhook
--   2. notes               — Ghi chú bổ sung (STK, referenceCode, match case)
-- Chạy trong Supabase SQL Editor
-- ============================================================

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS sepay_transaction_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS notes                TEXT;

CREATE INDEX IF NOT EXISTS idx_ft_sepay_txn_id
  ON finance_transactions(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;

-- Reload để PostgREST nhận cột mới ngay
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ finance_transactions: đã thêm sepay_transaction_id + notes. Rows hiện tại: %',
    (SELECT COUNT(*) FROM finance_transactions);
END $$;
