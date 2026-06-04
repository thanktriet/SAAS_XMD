-- ============================================================
-- MIGRATION: fix_finance_payment_method
-- Mở rộng CHECK constraint payment_method của finance_transactions
-- để chấp nhận 'qr_code' từ SEPay webhook
-- Chạy trong Supabase SQL Editor
-- ============================================================

-- Xoá constraint cũ
ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_payment_method_check;

-- Thêm constraint mới — bổ sung 'qr_code'
ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_payment_method_check
  CHECK (payment_method IN ('cash', 'bank_transfer', 'card', 'qr_code'));

-- Reload schema để PostgREST nhận ngay
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ finance_transactions: constraint payment_method đã bổ sung qr_code';
END $$;
