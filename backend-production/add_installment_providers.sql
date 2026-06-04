-- =============================================================================
-- Migration: tạo bảng installment_providers (đơn vị tài chính trả góp)
--   - Mỗi đơn vị có lãi suất cố định (%/tháng) + nhiều kỳ hạn cho phép
--   - Sale chọn đơn vị + chọn 1 kỳ hạn → tự fill lãi suất
-- =============================================================================

CREATE TABLE IF NOT EXISTS installment_providers (
  id                          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                        TEXT         NOT NULL,        -- "BIDV", "FE Credit", "HD SAISON"...
  interest_rate_per_month     NUMERIC(5,3) NOT NULL DEFAULT 0,  -- %/tháng (vd 1.2)
  available_months            INTEGER[]    NOT NULL DEFAULT ARRAY[6,12,18,24,36],  -- các kỳ hạn cho phép
  default_months              INTEGER      NOT NULL DEFAULT 12,
  min_down_payment_percent    NUMERIC(5,2) NOT NULL DEFAULT 0,  -- % tối thiểu phải đưa trước
  is_active                   BOOLEAN      NOT NULL DEFAULT true,
  note                        TEXT,
  sort_order                  INTEGER      NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Trigger updated_at (nếu chưa có function chung)
CREATE OR REPLACE FUNCTION trg_installment_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_installment_providers_updated_at ON installment_providers;
CREATE TRIGGER trg_installment_providers_updated_at
  BEFORE UPDATE ON installment_providers
  FOR EACH ROW
  EXECUTE FUNCTION trg_installment_updated_at();

-- Seed mẫu để có dữ liệu test
INSERT INTO installment_providers (name, interest_rate_per_month, available_months, default_months, min_down_payment_percent, sort_order)
VALUES
  ('FE Credit',  1.5, ARRAY[6,12,18,24,36],     12, 30, 1),
  ('HD SAISON', 1.4, ARRAY[6,12,18,24,36],     12, 20, 2),
  ('Mirae Asset', 1.3, ARRAY[12,18,24,36],      12, 25, 3),
  ('Home Credit', 1.6, ARRAY[6,12,18,24],        12, 30, 4),
  ('VPBank Trả Góp', 1.0, ARRAY[12,24,36,48],   24, 20, 5)
ON CONFLICT DO NOTHING;
