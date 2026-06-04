-- =============================================================================
-- Migration: thêm salesperson_id vào bảng customers
--   Mục đích: gắn KH với 1 sales chủ — sales chỉ xem được KH của mình
--   KH cũ (salesperson_id IS NULL) → chỉ admin/manager thấy
-- =============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_salesperson
  ON customers(salesperson_id) WHERE salesperson_id IS NOT NULL;

COMMENT ON COLUMN customers.salesperson_id IS
  'NULL = KH chưa có chủ (chỉ admin/manager thấy); UUID = sales chủ. Sales chỉ truy vấn được KH của mình';
