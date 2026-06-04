-- ═══════════════════════════════════════════════════════════════════════════════
-- PATCH: Bổ sung các cột còn thiếu trong purchase_order_items
-- ERP Xe Máy Điện · Supabase / PostgreSQL
-- ───────────────────────────────────────────────────────────────────────────────
-- Chạy file này nếu bảng purchase_order_items đã tồn tại (từ add_purchase_orders.sql)
-- nhưng chưa có các cột mở rộng từ add_po_multi_items.sql
--
-- An toàn để chạy nhiều lần (idempotent — dùng ADD COLUMN IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── purchase_order_items: thêm cột hỗ trợ đa loại hàng ──────────────────────

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS item_type     TEXT NOT NULL DEFAULT 'vehicle'
                            CHECK (item_type IN ('vehicle', 'spare_part', 'accessory')),
  ADD COLUMN IF NOT EXISTS spare_part_id UUID REFERENCES spare_parts(id)  ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS accessory_id  UUID REFERENCES accessories(id)  ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS item_name     TEXT,   -- tên hiển thị dự phòng khi join không có
  ADD COLUMN IF NOT EXISTS color         TEXT,
  ADD COLUMN IF NOT EXISTS year_manufacture SMALLINT;

-- ── purchase_orders: thêm cột tổng hợp nếu chưa có ─────────────────────────

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS item_type     TEXT NOT NULL DEFAULT 'vehicle'
                            CHECK (item_type IN ('vehicle', 'spare_part', 'accessory', 'mixed'));

-- ── qty_received: đổi constraint nếu cũ CHECK (qty_received > 0) ────────────
-- Không thể dùng ADD COLUMN IF NOT EXISTS cho cột đã có, chỉ log để biết
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_items' AND column_name = 'qty_received'
  ) THEN
    ALTER TABLE purchase_order_items
      ADD COLUMN qty_received INT NOT NULL DEFAULT 0 CHECK (qty_received >= 0);
  END IF;
END $$;

-- Xác nhận các cột đã có
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'purchase_order_items'
ORDER  BY ordinal_position;
