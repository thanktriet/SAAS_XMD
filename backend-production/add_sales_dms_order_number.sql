-- =============================================================================
-- Migration: thêm dms_order_number cho sales_orders
--   Mã đơn hàng từ hệ thống DMS VinFast — kế toán/manager nhập sau khi đơn hoàn tất
-- =============================================================================

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS dms_order_number TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_orders_dms_order_number
  ON sales_orders(dms_order_number) WHERE dms_order_number IS NOT NULL;

COMMENT ON COLUMN sales_orders.dms_order_number IS
  'Mã đơn hàng từ hệ thống DMS VinFast — kế toán/manager cập nhật sau khi đơn hoàn tất';
