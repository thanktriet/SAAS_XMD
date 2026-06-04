-- ============================================================
-- MIGRATION: Thêm module Đơn Nhập Hàng
-- Chạy trong Supabase SQL Editor
-- ============================================================

-- ─── BẢNG: purchase_orders (đơn nhập hàng từ nhà cung cấp) ──────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number      TEXT UNIQUE NOT NULL,          -- tự sinh: NK2026001
  supplier_name  TEXT NOT NULL,                  -- tên nhà cung cấp (text, không FK)
  supplier_phone TEXT,
  order_date     DATE DEFAULT CURRENT_DATE,
  expected_date  DATE,                           -- ngày dự kiến nhận hàng
  status         TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'received', 'cancelled')),
  subtotal       NUMERIC(15,2) DEFAULT 0,
  notes          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  received_date  DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BẢNG: purchase_order_items (chi tiết dòng xe trong đơn nhập) ────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id            UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  vehicle_model_id UUID REFERENCES vehicle_models(id) ON DELETE SET NULL,
  color            TEXT,
  year_manufacture INTEGER,
  qty_ordered      INTEGER NOT NULL DEFAULT 1,
  qty_received     INTEGER DEFAULT 0,
  unit_cost        NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total       NUMERIC(15,2) GENERATED ALWAYS AS (qty_ordered * unit_cost) STORED,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Trigger: tự động cập nhật updated_at ────────────────────────────────────
DROP TRIGGER IF EXISTS trg_updated_at ON purchase_orders;
CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Trigger: tự động tính subtotal khi items thay đổi ───────────────────────
CREATE OR REPLACE FUNCTION recalc_po_subtotal()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE purchase_orders
  SET subtotal = (
    SELECT COALESCE(SUM(qty_ordered * unit_cost), 0)
    FROM purchase_order_items
    WHERE po_id = COALESCE(NEW.po_id, OLD.po_id)
  )
  WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_po_subtotal ON purchase_order_items;
CREATE TRIGGER trg_po_subtotal
  AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION recalc_po_subtotal();

-- ─── Tự sinh mã PO: NK{năm}{5 chữ số} ───────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year   TEXT;
  v_seq    INTEGER;
  v_number TEXT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  SELECT COUNT(*) + 1 INTO v_seq
  FROM purchase_orders
  WHERE po_number LIKE 'NK' || v_year || '%';
  v_number := 'NK' || v_year || LPAD(v_seq::TEXT, 5, '0');
  NEW.po_number := v_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_po_number ON purchase_orders;
CREATE TRIGGER trg_po_number
  BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION generate_po_number();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read" ON purchase_orders;
CREATE POLICY "Allow authenticated read" ON purchase_orders
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated read" ON purchase_order_items;
CREATE POLICY "Allow authenticated read" ON purchase_order_items
  FOR SELECT TO authenticated USING (true);
