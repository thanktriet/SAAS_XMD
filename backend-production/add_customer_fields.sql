-- ============================================================
-- add_customer_fields.sql
-- Bổ sung: giới tính, nguồn KH (cá nhân) + người đại diện,
--          địa chỉ xuất hóa đơn (doanh nghiệp)
-- Chạy trong Supabase SQL Editor (an toàn — ADD COLUMN IF NOT EXISTS)
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS gender             TEXT
    CHECK (gender IN ('male', 'female', 'other')),

  ADD COLUMN IF NOT EXISTS source             TEXT
    CHECK (source IN (
      'referral',       -- Giới thiệu
      'facebook',       -- Facebook / Mạng xã hội
      'zalo',           -- Zalo
      'showroom',       -- Khách vãng lai tại showroom
      'website',        -- Website
      'call_center',    -- Tổng đài
      'other'           -- Khác
    )),

  -- CCCD mở rộng
  ADD COLUMN IF NOT EXISTS id_card_date       DATE,         -- Ngày cấp CCCD
  ADD COLUMN IF NOT EXISTS id_card_place      TEXT,         -- Nơi cấp CCCD

  -- Doanh nghiệp: người đại diện pháp lý
  ADD COLUMN IF NOT EXISTS representative_name  TEXT,
  ADD COLUMN IF NOT EXISTS representative_title TEXT,       -- Chức vụ: Giám đốc, KTT...

  -- Doanh nghiệp: địa chỉ xuất hóa đơn (có thể khác địa chỉ giao hàng)
  ADD COLUMN IF NOT EXISTS invoice_address      TEXT,
  ADD COLUMN IF NOT EXISTS invoice_district     TEXT,
  ADD COLUMN IF NOT EXISTS invoice_province     TEXT;

-- Xác nhận
DO $$
DECLARE v INT;
BEGIN
  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_name = 'customers'
    AND column_name IN (
      'gender','source',
      'id_card_date','id_card_place',
      'representative_name','representative_title',
      'invoice_address','invoice_district','invoice_province'
    );
  IF v = 9 THEN RAISE NOTICE '✅ Thêm 9 cột mới vào customers thành công.';
  ELSE            RAISE WARNING '⚠️  Chỉ có % / 9 cột tồn tại.', v;
  END IF;
END $$;
