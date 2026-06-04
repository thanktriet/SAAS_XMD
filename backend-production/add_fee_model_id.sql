-- =============================================================================
-- Migration: thêm model_id vào fee_settings
--   Mục đích: cho phép phí cố định áp dụng theo từng mẫu xe (vd phí trước bạ)
--   model_id = NULL  → áp dụng cho tất cả mẫu xe (phí global)
--   model_id = <id>  → chỉ áp dụng cho mẫu xe đó
-- =============================================================================

-- 1. Thêm cột
ALTER TABLE fee_settings
  ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES vehicle_models(id) ON DELETE CASCADE;

-- 2. Bỏ UNIQUE trên key — giờ cùng key có thể có nhiều dòng (mỗi model 1 dòng)
ALTER TABLE fee_settings
  DROP CONSTRAINT IF EXISTS fee_settings_key_key;

-- 3. Index để truy vấn nhanh theo model
CREATE INDEX IF NOT EXISTS idx_fee_settings_model_id
  ON fee_settings(model_id) WHERE model_id IS NOT NULL;

-- 4. Comment cho cột mới
COMMENT ON COLUMN fee_settings.model_id IS
  'NULL = phí áp dụng cho tất cả mẫu xe; UUID = chỉ áp dụng cho mẫu xe cụ thể (vd phí trước bạ riêng cho từng dòng xe)';
