-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Kho Phụ Kiện & Quà Tặng
-- ERP Xe Máy Điện · Supabase / PostgreSQL
-- ───────────────────────────────────────────────────────────────────────────────
-- Thiết kế: cùng pattern với spare_parts + stock_movements
--   accessories    → danh mục & tồn kho phụ kiện
--   gift_items     → danh mục & tồn kho quà tặng
--   item_movements → phiếu nhập/xuất/điều chỉnh chung cho CẢ HAI kho
--                    (spare_parts vẫn dùng stock_movements cũ — không đụng)
-- Idempotent: dùng IF NOT EXISTS trên toàn bộ file
-- ═══════════════════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. BẢNG: accessories (phụ kiện)
-- Ví dụ: túi xe, baga, giỏ, khóa chống trộm, áo mưa đi kèm...
-- ============================================================
CREATE TABLE IF NOT EXISTS accessories (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã tự sinh: PK + sequence  (PK240001)
  code            TEXT          UNIQUE NOT NULL,

  name            TEXT          NOT NULL,
  brand           TEXT,                          -- VinFast Original, NoName, ...
  category        TEXT,                          -- tui_xe, baga, khoa, ao_mua, ...

  -- Đơn vị tính
  unit            TEXT          NOT NULL DEFAULT 'cái',

  -- Tồn kho (cập nhật qua trigger item_movements)
  qty_in_stock    INTEGER       NOT NULL DEFAULT 0,
  qty_minimum     INTEGER       NOT NULL DEFAULT 3,   -- ngưỡng cảnh báo hết hàng

  -- Giá
  price_cost      INTEGER       NOT NULL DEFAULT 0,   -- giá nhập (VND integer)
  price_sell      INTEGER       NOT NULL DEFAULT 0,   -- giá bán lẻ

  -- Tương thích dòng xe (nullable = dùng được cho tất cả)
  compatible_models TEXT[],     -- mảng vehicle_model.id hoặc tên model

  supplier        TEXT,
  image_url       TEXT,
  note            TEXT,

  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Trigger updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accessories_updated_at'
  ) THEN
    CREATE TRIGGER trg_accessories_updated_at
      BEFORE UPDATE ON accessories
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Tự sinh code dạng PK + YYYYMM + 4 số
CREATE OR REPLACE FUNCTION generate_accessory_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT := 'PK' || TO_CHAR(NOW(), 'YYYYMM');
  v_count  INTEGER;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    SELECT COUNT(*) + 1 INTO v_count
      FROM accessories WHERE code LIKE v_prefix || '%';
    NEW.code := v_prefix || LPAD(v_count::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accessory_code'
  ) THEN
    CREATE TRIGGER trg_accessory_code
      BEFORE INSERT ON accessories
      FOR EACH ROW EXECUTE FUNCTION generate_accessory_code();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accessories_category  ON accessories(category);
CREATE INDEX IF NOT EXISTS idx_accessories_low_stock ON accessories(qty_in_stock)
  WHERE qty_in_stock <= qty_minimum;


-- ============================================================
-- 2. BẢNG: gift_items (quà tặng / khuyến mãi)
-- Ví dụ: mũ bảo hiểm kèm xe, phiếu bảo dưỡng miễn phí, voucher...
-- ============================================================
CREATE TABLE IF NOT EXISTS gift_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã tự sinh: QT + YYYYMM + 4 số
  code            TEXT          UNIQUE NOT NULL,

  name            TEXT          NOT NULL,
  gift_type       TEXT          NOT NULL DEFAULT 'physical' CHECK (
    gift_type IN (
      'physical',    -- vật phẩm có kho: mũ BH, áo mưa, túi...
      'voucher',     -- phiếu dịch vụ: bảo dưỡng miễn phí, rửa xe...
      'insurance'    -- bảo hiểm đính kèm
    )
  ),

  category        TEXT,                          -- mu_bao_hiem, ao_mua, voucher_baoduong...
  unit            TEXT          NOT NULL DEFAULT 'cái',

  -- Chỉ có ý nghĩa khi gift_type = 'physical'
  qty_in_stock    INTEGER       NOT NULL DEFAULT 0,
  qty_minimum     INTEGER       NOT NULL DEFAULT 0,

  -- Giá trị nội bộ (để tính chi phí khuyến mãi)
  cost_value      INTEGER       NOT NULL DEFAULT 0,   -- chi phí thực tế cho DN
  retail_value    INTEGER       NOT NULL DEFAULT 0,   -- giá trị công bố với KH

  -- Gán vào chương trình khuyến mãi / đợt bán xe
  campaign_id     UUID,                          -- FK tới promotion_campaigns nếu sau này có
  applicable_models TEXT[],     -- dòng xe được nhận quà này

  -- Voucher: thông tin bổ sung
  voucher_service TEXT,         -- tên dịch vụ nếu là voucher
  expiry_months   SMALLINT,     -- thời hạn sử dụng (tháng) kể từ ngày phát

  supplier        TEXT,
  image_url       TEXT,
  note            TEXT,

  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gift_items_updated_at'
  ) THEN
    CREATE TRIGGER trg_gift_items_updated_at
      BEFORE UPDATE ON gift_items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION generate_gift_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT := 'QT' || TO_CHAR(NOW(), 'YYYYMM');
  v_count  INTEGER;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    SELECT COUNT(*) + 1 INTO v_count
      FROM gift_items WHERE code LIKE v_prefix || '%';
    NEW.code := v_prefix || LPAD(v_count::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gift_code'
  ) THEN
    CREATE TRIGGER trg_gift_code
      BEFORE INSERT ON gift_items
      FOR EACH ROW EXECUTE FUNCTION generate_gift_code();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gift_items_type     ON gift_items(gift_type);
CREATE INDEX IF NOT EXISTS idx_gift_items_campaign ON gift_items(campaign_id) WHERE campaign_id IS NOT NULL;


-- ============================================================
-- 3. BẢNG: item_movements (nhập/xuất kho chung)
-- Dùng cho accessories + gift_items (physical).
-- spare_parts vẫn dùng stock_movements cũ — không thay đổi.
-- ============================================================
CREATE TABLE IF NOT EXISTS item_movements (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Loại hàng (phân biệt nguồn gốc bản ghi)
  item_type       TEXT          NOT NULL CHECK (item_type IN ('accessory', 'gift')),
  item_id         UUID          NOT NULL,  -- FK logic tới accessories.id hoặc gift_items.id

  movement_type   TEXT          NOT NULL CHECK (
    movement_type IN (
      'import',      -- nhập kho từ nhà cung cấp
      'export',      -- xuất kho (bán lẻ, tặng kèm xe)
      'adjustment',  -- kiểm kê điều chỉnh
      'transfer'     -- chuyển kho giữa chi nhánh
    )
  ),

  quantity        INTEGER       NOT NULL CHECK (quantity > 0),
  quantity_before INTEGER,      -- tồn trước khi có phiếu (snapshot lúc insert)
  quantity_after  INTEGER,      -- tồn sau (snapshot)

  -- Liên kết nghiệp vụ
  reference_type  TEXT,         -- 'sales_order' | 'purchase_order' | 'manual' | ...
  reference_id    UUID,         -- ID của đơn hàng / phiếu nhập liên quan

  -- Xuất kèm xe (đặc thù quà tặng)
  sales_order_id  UUID          REFERENCES sales_orders(id) ON DELETE SET NULL,
  customer_id     UUID          REFERENCES customers(id)    ON DELETE SET NULL,

  unit_cost       INTEGER,      -- giá nhập tại thời điểm (cho import)
  branch_id       UUID,         -- chi nhánh phát sinh

  notes           TEXT,
  created_by      UUID          REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_movements_item     ON item_movements(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_item_movements_ref      ON item_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_item_movements_order    ON item_movements(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_movements_date     ON item_movements(created_at DESC);


-- ============================================================
-- 4. TRIGGER: Tự cập nhật qty_in_stock khi có item_movement
-- Cùng pattern với trg_stock_movement cho spare_parts
-- ============================================================
CREATE OR REPLACE FUNCTION update_item_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_delta    INTEGER;
  v_before   INTEGER;
  v_after    INTEGER;
BEGIN
  -- import → cộng, mọi loại khác → trừ  (adjustment có thể âm nếu cần → dùng notes)
  v_delta := CASE
    WHEN NEW.movement_type IN ('import') THEN  NEW.quantity
    ELSE                                       -NEW.quantity
  END;

  IF NEW.item_type = 'accessory' THEN
    UPDATE accessories
       SET qty_in_stock = qty_in_stock + v_delta
     WHERE id = NEW.item_id
    RETURNING qty_in_stock - v_delta, qty_in_stock
      INTO v_before, v_after;

  ELSIF NEW.item_type = 'gift' THEN
    UPDATE gift_items
       SET qty_in_stock = qty_in_stock + v_delta
     WHERE id = NEW.item_id AND gift_type = 'physical'
    RETURNING qty_in_stock - v_delta, qty_in_stock
      INTO v_before, v_after;
  END IF;

  -- Ghi snapshot trở lại vào chính bản ghi vừa insert
  UPDATE item_movements
     SET quantity_before = v_before,
         quantity_after  = v_after
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_movement ON item_movements;
CREATE TRIGGER trg_item_movement
  AFTER INSERT ON item_movements
  FOR EACH ROW EXECUTE FUNCTION update_item_stock();


-- ============================================================
-- 5. BẢNG: order_gifts (quà tặng đã phát theo đơn hàng)
-- Ghi nhận: đơn hàng X tặng kèm quà Y (dùng để in phiếu + tra cứu)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_gifts (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_order_id  UUID          NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  gift_item_id    UUID          NOT NULL REFERENCES gift_items(id),
  quantity        INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),

  -- Voucher: sinh mã khi phát
  voucher_code    TEXT          UNIQUE,          -- QTV-20260330-XXXX
  voucher_issued_at TIMESTAMPTZ,
  voucher_used_at   TIMESTAMPTZ,

  note            TEXT,
  created_by      UUID          REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_gifts_order ON order_gifts(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_order_gifts_gift  ON order_gifts(gift_item_id);
CREATE INDEX IF NOT EXISTS idx_order_gifts_voucher ON order_gifts(voucher_code) WHERE voucher_code IS NOT NULL;

-- Tự sinh voucher_code khi gift_type = 'voucher'
CREATE OR REPLACE FUNCTION generate_voucher_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_type TEXT;
BEGIN
  SELECT gift_type INTO v_type FROM gift_items WHERE id = NEW.gift_item_id;
  IF v_type = 'voucher' AND NEW.voucher_code IS NULL THEN
    NEW.voucher_code := 'QTV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
                        || UPPER(SUBSTRING(NEW.id::TEXT FROM 1 FOR 6));
    NEW.voucher_issued_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_gift_voucher ON order_gifts;
CREATE TRIGGER trg_order_gift_voucher
  BEFORE INSERT ON order_gifts
  FOR EACH ROW EXECUTE FUNCTION generate_voucher_code();


-- ============================================================
-- 6. VIEW: v_accessory_stock_alert — phụ kiện sắp hết hàng
-- ============================================================
CREATE OR REPLACE VIEW v_accessory_stock_alert AS
SELECT
  id,
  code,
  name,
  category,
  unit,
  qty_in_stock,
  qty_minimum,
  price_sell,
  supplier,
  CASE
    WHEN qty_in_stock = 0          THEN 'het_hang'
    WHEN qty_in_stock <= qty_minimum THEN 'sap_het'
    ELSE 'binh_thuong'
  END AS stock_status
FROM accessories
WHERE is_active = TRUE
  AND qty_in_stock <= qty_minimum
ORDER BY qty_in_stock ASC;


-- ============================================================
-- 7. VIEW: v_gift_stock_alert — quà tặng vật phẩm sắp hết
-- ============================================================
CREATE OR REPLACE VIEW v_gift_stock_alert AS
SELECT
  id,
  code,
  name,
  gift_type,
  category,
  unit,
  qty_in_stock,
  qty_minimum,
  cost_value,
  CASE
    WHEN qty_in_stock = 0            THEN 'het_hang'
    WHEN qty_in_stock <= qty_minimum THEN 'sap_het'
    ELSE 'binh_thuong'
  END AS stock_status
FROM gift_items
WHERE is_active = TRUE
  AND gift_type = 'physical'
  AND qty_in_stock <= qty_minimum
ORDER BY qty_in_stock ASC;


-- ============================================================
-- 8. RLS: bật + phân quyền
-- warehouse → xem + nhập/xuất
-- sales     → xem accessories + order_gifts (để tư vấn)
-- manager + admin → toàn quyền
-- ============================================================
ALTER TABLE accessories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_gifts    ENABLE ROW LEVEL SECURITY;

-- Helper role (dùng lại fn_user_role từ 20260330000001 nếu đã có,
--             hoặc fallback về users.role)
CREATE OR REPLACE FUNCTION _get_user_role_for_inventory()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT acc_role FROM accounting_user_profiles WHERE id = auth.uid()),
    (SELECT role     FROM users                     WHERE id = auth.uid())
  );
$$;

-- accessories --
DROP POLICY IF EXISTS "acc_warehouse_all"  ON accessories;
DROP POLICY IF EXISTS "acc_sales_read"     ON accessories;
DROP POLICY IF EXISTS "acc_manager_all"    ON accessories;

CREATE POLICY "acc_warehouse_all" ON accessories
  USING (_get_user_role_for_inventory() IN ('warehouse', 'admin', 'manager'));

CREATE POLICY "acc_sales_read" ON accessories
  FOR SELECT USING (
    _get_user_role_for_inventory() IN ('sales', 'cashier', 'accountant')
    AND is_active = TRUE
  );

-- gift_items --
DROP POLICY IF EXISTS "gift_warehouse_all" ON gift_items;
DROP POLICY IF EXISTS "gift_sales_read"    ON gift_items;

CREATE POLICY "gift_warehouse_all" ON gift_items
  USING (_get_user_role_for_inventory() IN ('warehouse', 'admin', 'manager'));

CREATE POLICY "gift_sales_read" ON gift_items
  FOR SELECT USING (
    _get_user_role_for_inventory() IN ('sales', 'cashier', 'accountant')
    AND is_active = TRUE
  );

-- item_movements --
DROP POLICY IF EXISTS "movements_warehouse" ON item_movements;
DROP POLICY IF EXISTS "movements_manager"   ON item_movements;

CREATE POLICY "movements_warehouse" ON item_movements
  USING (_get_user_role_for_inventory() IN ('warehouse', 'admin', 'manager'));

-- order_gifts --
DROP POLICY IF EXISTS "order_gifts_read"    ON order_gifts;
DROP POLICY IF EXISTS "order_gifts_write"   ON order_gifts;

CREATE POLICY "order_gifts_read" ON order_gifts
  FOR SELECT USING (
    _get_user_role_for_inventory() IN ('sales', 'warehouse', 'manager', 'admin', 'cashier')
  );

CREATE POLICY "order_gifts_write" ON order_gifts
  FOR INSERT WITH CHECK (
    _get_user_role_for_inventory() IN ('sales', 'warehouse', 'manager', 'admin')
  );


-- ============================================================
-- 9. Bổ sung accessories vào purchase_order_items (nếu chưa có)
-- patch_purchase_order_items_columns.sql đã thêm accessory_id,
-- file này chỉ đảm bảo FK tồn tại
-- ============================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'purchase_order_items'
       AND column_name = 'accessory_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
     WHERE tc.table_name   = 'purchase_order_items'
       AND ccu.column_name = 'accessory_id'
       AND tc.constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE purchase_order_items
      ADD CONSTRAINT fk_poi_accessory
        FOREIGN KEY (accessory_id) REFERENCES accessories(id) ON DELETE RESTRICT;
  END IF;
END $$;
