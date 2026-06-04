-- ============================================================
-- add_payment_settings.sql
-- Bảng cấu hình thanh toán SEPay — thay thế VITE_BANK_* env vars
-- Chạy trong Supabase SQL Editor
-- ============================================================

-- Đảm bảo function updated_at tồn tại (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Tạo bảng
CREATE TABLE IF NOT EXISTS payment_settings (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT        UNIQUE NOT NULL,
  value       TEXT        NOT NULL DEFAULT '',
  label       TEXT        NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger tự cập nhật updated_at
DROP TRIGGER IF EXISTS trg_payment_settings_updated_at ON payment_settings;
CREATE TRIGGER trg_payment_settings_updated_at
  BEFORE UPDATE ON payment_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed dữ liệu mặc định
INSERT INTO payment_settings (key, value, label) VALUES
  ('bank_code',         'TCB',          'Mã ngân hàng SEPay (vd: TCB, VCB, MB, ACB)'),
  ('bank_name',         'Techcombank',  'Tên ngân hàng hiển thị'),
  ('bank_account',      '',             'Số tài khoản thụ hưởng'),
  ('bank_account_name', '',             'Tên chủ tài khoản'),
  ('sepay_api_key',     '',             'API Key SEPay (dùng xác thực webhook)'),
  ('max_cash_allowed',  '50000000',     'Ngưỡng cảnh báo tồn quỹ tiền mặt (VND)')
ON CONFLICT (key) DO NOTHING;

-- Reload schema cache để PostgREST nhận bảng mới ngay
NOTIFY pgrst, 'reload schema';

-- Xác nhận
DO $$
BEGIN
  RAISE NOTICE '✅ payment_settings: % rows.', (SELECT COUNT(*) FROM payment_settings);
END $$;
