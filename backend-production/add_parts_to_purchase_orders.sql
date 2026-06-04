-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Mở rộng Đơn Nhập Hàng — Thêm Phụ Tùng & Phụ Kiện
-- ERP Xe Máy Điện · Supabase / PostgreSQL
-- ───────────────────────────────────────────────────────────────────────────────
-- CHẠY SAU: purchase_orders.sql đã chạy thành công
-- CHỈ chạy file này — KHÔNG chạy lại purchase_orders.sql
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- BƯỚC 0: Thêm item_type vào bảng purchase_orders (đầu phiếu)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'vehicle'
    CHECK (item_type IN ('vehicle', 'spare_part', 'accessory'));

COMMENT ON COLUMN purchase_orders.item_type IS
  'Loại hàng của đơn nhập. Mỗi đơn chỉ được nhập 1 loại: vehicle / spare_part / accessory.';

-- ─────────────────────────────────────────────────────────────────────────────
-- BƯỚC 1: Mở rộng purchase_order_items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_order_items
  ALTER COLUMN vehicle_model_id DROP NOT NULL;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'vehicle'
    CHECK (item_type IN ('vehicle', 'spare_part', 'accessory'));

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS spare_part_id UUID REFERENCES spare_parts(id) ON DELETE RESTRICT;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS accessory_id UUID REFERENCES accessories(id) ON DELETE RESTRICT;

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS chk_poi_item_type;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT chk_poi_item_type CHECK (
    (item_type = 'vehicle'    AND vehicle_model_id IS NOT NULL AND spare_part_id IS NULL    AND accessory_id IS NULL) OR
    (item_type = 'spare_part' AND spare_part_id    IS NOT NULL AND vehicle_model_id IS NULL AND accessory_id IS NULL) OR
    (item_type = 'accessory'  AND accessory_id     IS NOT NULL AND vehicle_model_id IS NULL AND spare_part_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_poi_spare_part ON purchase_order_items(spare_part_id) WHERE spare_part_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poi_accessory  ON purchase_order_items(accessory_id)  WHERE accessory_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poi_item_type  ON purchase_order_items(item_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- BƯỚC 2: Mở rộng purchase_receipt_items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_receipt_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'vehicle'
    CHECK (item_type IN ('vehicle', 'spare_part', 'accessory'));

ALTER TABLE purchase_receipt_items
  ADD COLUMN IF NOT EXISTS spare_part_id UUID REFERENCES spare_parts(id) ON DELETE RESTRICT;

ALTER TABLE purchase_receipt_items
  ADD COLUMN IF NOT EXISTS accessory_id UUID REFERENCES accessories(id) ON DELETE RESTRICT;

ALTER TABLE purchase_receipt_items
  ADD COLUMN IF NOT EXISTS qty_received INT NOT NULL DEFAULT 1
    CHECK (qty_received > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- BƯỚC 2b: Trigger kiểm tra item_type của item phải khớp với đầu phiếu
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_poi_item_type()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_po_type TEXT;
BEGIN
  SELECT item_type INTO v_po_type
  FROM   purchase_orders WHERE id = NEW.po_id;

  IF NEW.item_type != v_po_type THEN
    RAISE EXCEPTION
      'Loại hàng của dòng (%) không khớp với loại đơn nhập (%). '
      'Mỗi đơn chỉ được nhập 1 loại hàng duy nhất.',
      NEW.item_type, v_po_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_poi_item_type ON purchase_order_items;
CREATE TRIGGER trg_check_poi_item_type
  BEFORE INSERT OR UPDATE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION fn_check_poi_item_type();

-- Trigger cấm đổi item_type khi đơn đã có items
CREATE OR REPLACE FUNCTION fn_protect_po_item_type()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cnt INT;
BEGIN
  IF NEW.item_type IS DISTINCT FROM OLD.item_type THEN
    SELECT COUNT(*) INTO v_cnt FROM purchase_order_items WHERE po_id = OLD.id;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION
        'Không thể thay đổi loại hàng của đơn % vì đã có % dòng chi tiết.',
        OLD.po_number, v_cnt;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_po_item_type ON purchase_orders;
CREATE TRIGGER trg_protect_po_item_type
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fn_protect_po_item_type();

-- ─────────────────────────────────────────────────────────────────────────────
-- BƯỚC 3: Cập nhật trigger fn_receipt_accepted
-- Xe → tạo inventory_vehicles
-- Phụ tùng → ghi stock_movements (trigger cộng qty_in_stock)
-- Phụ kiện → cộng qty_received trên PO item
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_receipt_accepted()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_item           RECORD;
  v_vehicle_id     UUID;
  v_total_ordered  INT;
  v_total_received INT;
BEGIN
  IF NOT (NEW.status = 'accepted' AND OLD.status != 'accepted') THEN
    RETURN NEW;
  END IF;

  FOR v_item IN
    SELECT
      pri.*,
      poi.item_type,
      poi.vehicle_model_id,
      poi.spare_part_id,
      poi.accessory_id,
      poi.unit_cost
    FROM   purchase_receipt_items pri
    JOIN   purchase_order_items   poi ON poi.id = pri.po_item_id
    WHERE  pri.receipt_id = NEW.id
      AND  pri.condition  IN ('ok', 'defect')
  LOOP

    IF v_item.item_type = 'vehicle' THEN
      IF v_item.inventory_vehicle_id IS NULL THEN
        INSERT INTO inventory_vehicles
          (vehicle_model_id, vin, engine_number, battery_serial, color,
           year_manufacture, status, import_date, import_price, notes)
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
             ELSE NULL
           END)
        RETURNING id INTO v_vehicle_id;

        UPDATE purchase_receipt_items
        SET    inventory_vehicle_id = v_vehicle_id
        WHERE  id = v_item.id;
      END IF;

      UPDATE purchase_order_items
      SET    qty_received = qty_received + 1
      WHERE  id = v_item.po_item_id;

    ELSIF v_item.item_type = 'spare_part' THEN
      INSERT INTO stock_movements
        (spare_part_id, movement_type, quantity, reference_id, reference_type, notes, created_by)
      SELECT
        v_item.spare_part_id,
        'import',
        v_item.qty_received,
        NEW.id,
        'purchase_receipt',
        'Nhập hàng từ đơn ' || (SELECT po_number FROM purchase_orders WHERE id = NEW.po_id),
        NEW.received_by;

      UPDATE purchase_order_items
      SET    qty_received = qty_received + v_item.qty_received
      WHERE  id = v_item.po_item_id;

    ELSIF v_item.item_type = 'accessory' THEN
      UPDATE purchase_order_items
      SET    qty_received = qty_received + v_item.qty_received
      WHERE  id = v_item.po_item_id;
    END IF;

  END LOOP;

  SELECT SUM(qty_ordered), SUM(qty_received)
  INTO   v_total_ordered, v_total_received
  FROM   purchase_order_items
  WHERE  po_id = NEW.po_id;

  IF v_total_received >= v_total_ordered THEN
    UPDATE purchase_orders
    SET    status      = 'fully_received',
           actual_date = NEW.receipt_date
    WHERE  id = NEW.po_id AND status NOT IN ('invoiced', 'paid', 'cancelled');
  ELSIF v_total_received > 0 THEN
    UPDATE purchase_orders
    SET    status = 'partial_received'
    WHERE  id = NEW.po_id AND status = 'approved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_accepted ON purchase_receipts;
CREATE TRIGGER trg_receipt_accepted
  AFTER UPDATE ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_receipt_accepted();

-- ─────────────────────────────────────────────────────────────────────────────
-- KIỂM TRA
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_po        BOOLEAN;
  v_poi_type  BOOLEAN;
  v_poi_sp    BOOLEAN;
  v_poi_acc   BOOLEAN;
  v_pri_type  BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_orders'       AND column_name = 'item_type')    INTO v_po;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_order_items'  AND column_name = 'item_type')    INTO v_poi_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_order_items'  AND column_name = 'spare_part_id') INTO v_poi_sp;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_order_items'  AND column_name = 'accessory_id')  INTO v_poi_acc;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_receipt_items' AND column_name = 'item_type')   INTO v_pri_type;

  IF v_po AND v_poi_type AND v_poi_sp AND v_poi_acc AND v_pri_type THEN
    RAISE NOTICE '══════════════════════════════════════════════════════════';
    RAISE NOTICE '  Migration add_parts_to_purchase_orders — THÀNH CÔNG ✓';
    RAISE NOTICE '  ✓ purchase_orders.item_type';
    RAISE NOTICE '  ✓ purchase_order_items: item_type / spare_part_id / accessory_id';
    RAISE NOTICE '  ✓ purchase_receipt_items: item_type / spare_part_id / accessory_id / qty_received';
    RAISE NOTICE '  ✓ Trigger kiểm tra 1 đơn = 1 loại hàng';
    RAISE NOTICE '  ✓ Trigger nhận hàng: xe → kho | phụ tùng → stock_movements';
    RAISE NOTICE '══════════════════════════════════════════════════════════';
  ELSE
    RAISE WARNING 'Migration chưa hoàn chỉnh!';
    RAISE WARNING '  purchase_orders.item_type       : %', v_po;
    RAISE WARNING '  purchase_order_items.item_type  : %', v_poi_type;
    RAISE WARNING '  purchase_order_items.spare_part : %', v_poi_sp;
    RAISE WARNING '  purchase_order_items.accessory  : %', v_poi_acc;
    RAISE WARNING '  purchase_receipt_items.item_type: %', v_pri_type;
  END IF;
END;
$$;

COMMIT;
