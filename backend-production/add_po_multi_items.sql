-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Mở rộng đơn nhập hàng — hỗ trợ Xe + Phụ tùng + Phụ kiện
-- Chạy SAU: purchase_orders.sql (hoặc add_purchase_orders.sql) đã thành công
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Thêm cột đa loại hàng vào purchase_order_items
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS item_type      TEXT NOT NULL DEFAULT 'xe'
    CHECK (item_type IN ('xe', 'phu_tung', 'phu_kien')),
  ADD COLUMN IF NOT EXISTS spare_part_id  UUID REFERENCES spare_parts(id)  ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS accessory_id   UUID REFERENCES accessories(id)  ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS item_name      TEXT;   -- tên hiển thị khi không có FK

-- Bỏ NOT NULL trên vehicle_model_id để phụ tùng/phụ kiện không cần điền
-- (bỏ qua nếu cột đã nullable)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_items'
      AND column_name = 'vehicle_model_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE purchase_order_items
      ALTER COLUMN vehicle_model_id DROP NOT NULL;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Thêm cột đa loại vào purchase_receipt_items (để nhận hàng theo loại)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_receipt_items
  ADD COLUMN IF NOT EXISTS item_type     TEXT NOT NULL DEFAULT 'xe'
    CHECK (item_type IN ('xe', 'phu_tung', 'phu_kien')),
  ADD COLUMN IF NOT EXISTS spare_part_id UUID REFERENCES spare_parts(id),
  ADD COLUMN IF NOT EXISTS accessory_id  UUID REFERENCES accessories(id),
  ADD COLUMN IF NOT EXISTS qty_received  INT  NOT NULL DEFAULT 1 CHECK (qty_received > 0);
-- qty_received dùng cho phu_tung / phu_kien (xe vẫn dùng VIN từng chiếc)

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Cập nhật trigger fn_receipt_accepted: xử lý thêm phụ tùng + phụ kiện
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_receipt_accepted()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_item           RECORD;
  v_vehicle_id     UUID;
  v_total_ordered  INT;
  v_total_received INT;
BEGIN
  -- Chỉ xử lý khi chuyển sang accepted
  IF NOT (NEW.status = 'accepted' AND OLD.status != 'accepted') THEN
    RETURN NEW;
  END IF;

  -- ── Duyệt từng dòng trong phiếu nhận ──────────────────────────────────────
  FOR v_item IN
    SELECT
      pri.*,
      poi.vehicle_model_id,
      poi.spare_part_id,
      poi.accessory_id,
      poi.item_type AS poi_item_type,
      poi.unit_cost,
      po.branch_id
    FROM   purchase_receipt_items pri
    JOIN   purchase_order_items   poi ON poi.id = pri.po_item_id
    JOIN   purchase_orders        po  ON po.id  = NEW.po_id
    WHERE  pri.receipt_id = NEW.id
  LOOP

    -- ── XE: tạo inventory_vehicles ───────────────────────────────────────────
    IF v_item.poi_item_type = 'xe' AND v_item.condition IN ('ok', 'defect') THEN
      IF v_item.inventory_vehicle_id IS NULL THEN
        INSERT INTO inventory_vehicles
          (vehicle_model_id, vin, engine_number, battery_serial,
           color, year_manufacture, status, import_date, import_price, notes)
        VALUES
          (v_item.vehicle_model_id,
           v_item.vin,
           v_item.engine_number,
           v_item.battery_serial,
           v_item.color,
           v_item.year_manufacture,
           'in_stock',
           NEW.receipt_date,
           COALESCE(v_item.actual_unit_cost, v_item.unit_cost),
           CASE v_item.condition
             WHEN 'defect' THEN 'Nhập kho có lỗi: ' || COALESCE(v_item.defect_notes, '')
             ELSE NULL END)
        RETURNING id INTO v_vehicle_id;

        UPDATE purchase_receipt_items
          SET inventory_vehicle_id = v_vehicle_id
        WHERE id = v_item.id;
      END IF;

      UPDATE purchase_order_items
        SET qty_received = qty_received + 1
      WHERE id = v_item.po_item_id;

    -- ── PHỤ TÙNG: tạo stock_movement → tự cộng qty_in_stock ─────────────────
    ELSIF v_item.poi_item_type = 'phu_tung' AND v_item.spare_part_id IS NOT NULL THEN
      INSERT INTO stock_movements
        (spare_part_id, movement_type, quantity,
         quantity_before, quantity_after,
         reference_id, reference_type, notes, created_by)
      SELECT
        v_item.spare_part_id,
        'import',
        v_item.qty_received,
        sp.qty_in_stock,
        sp.qty_in_stock + v_item.qty_received,
        NEW.id,
        'purchase_receipt',
        'Nhập kho từ phiếu ' || NEW.receipt_number,
        NEW.received_by
      FROM spare_parts sp WHERE sp.id = v_item.spare_part_id;

      UPDATE purchase_order_items
        SET qty_received = qty_received + v_item.qty_received
      WHERE id = v_item.po_item_id;

    -- ── PHỤ KIỆN: cập nhật qty_received trên PO item (không có kho riêng) ────
    ELSIF v_item.poi_item_type = 'phu_kien' THEN
      UPDATE purchase_order_items
        SET qty_received = qty_received + v_item.qty_received
      WHERE id = v_item.po_item_id;
    END IF;

  END LOOP;

  -- ── Kiểm tra PO đã nhận đủ chưa ──────────────────────────────────────────
  SELECT COALESCE(SUM(qty_ordered), 0),
         COALESCE(SUM(qty_received), 0)
  INTO   v_total_ordered, v_total_received
  FROM   purchase_order_items
  WHERE  po_id = NEW.po_id;

  IF v_total_received >= v_total_ordered THEN
    UPDATE purchase_orders
      SET status      = 'fully_received',
          actual_date = NEW.receipt_date
    WHERE id = NEW.po_id
      AND status NOT IN ('invoiced', 'paid', 'cancelled');
  ELSIF v_total_received > 0 THEN
    UPDATE purchase_orders
      SET status = 'partial_received'
    WHERE id = NEW.po_id AND status = 'approved';
  END IF;

  RETURN NEW;
END;
$$;

-- Gắn lại trigger (xóa cũ nếu có)
DROP TRIGGER IF EXISTS trg_receipt_accepted ON purchase_receipts;
CREATE TRIGGER trg_receipt_accepted
  AFTER UPDATE ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_receipt_accepted();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Kiểm tra
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '  Migration add_po_multi_items — Hoàn thành';
  RAISE NOTICE '  ✓ purchase_order_items: thêm item_type, spare_part_id, accessory_id';
  RAISE NOTICE '  ✓ purchase_receipt_items: thêm item_type, spare_part_id, qty_received';
  RAISE NOTICE '  ✓ trigger fn_receipt_accepted: xử lý xe + phụ tùng + phụ kiện';
  RAISE NOTICE '══════════════════════════════════════════════════════';
END;
$$;

COMMIT;
