-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION FIX: add_accessories_and_gifts_v2
-- Vấn đề: bảng accessories đã tồn tại với schema CŨ (thiếu columns)
-- Giải pháp: ALTER TABLE ADD COLUMN IF NOT EXISTS + tạo 3 bảng mới
-- Idempotent: chạy lại nhiều lần không lỗi
-- ═══════════════════════════════════════════════════════════════════════════════

-- ============================================================
-- 0. Đảm bảo hàm update_updated_at tồn tại
--    (đã có trong schema.sql — thêm OR REPLACE cho an toàn)
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. ALTER accessories: thêm columns mới vào bảng đã tồn tại
-- ============================================================

-- Đổi tên price → price_sell (nếu cột price còn tồn tại)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accessories' AND column_name = 'price'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accessories' AND column_name = 'price_sell'
  ) THEN
    ALTER TABLE accessories RENAME COLUMN price TO price_sell;
  END IF;
END $$;

-- Thêm price_sell nếu chưa có cả price lẫn price_sell
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS price_sell    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS brand         TEXT;
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS qty_in_stock  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS qty_minimum   INTEGER NOT NULL DEFAULT 3;
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS price_cost    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS supplier      TEXT;
ALTER TABLE accessories ADD COLUMN IF NOT EXISTS note          TEXT;

-- description → note (nếu description còn tồn tại và note chưa có data)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accessories' AND column_name = 'description'
  ) THEN
    -- Sao chép data description → note trước khi xóa
    UPDATE accessories SET note = description WHERE note IS NULL AND description IS NOT NULL;
    ALTER TABLE accessories DROP COLUMN IF EXISTS description;
  END IF;
END $$;

-- Trigger updated_at cho accessories
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
-- 2. BẢNG MỚI: gift_items (quà tặng / khuyến mãi)
-- ============================================================
CREATE TABLE IF NOT EXISTS gift_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            TEXT          UNIQUE NOT NULL,      -- QT + YYYYMM + 4 số

  name            TEXT          NOT NULL,
  category        TEXT,                               -- mu_bao_hiem, ao_mua, voucher, ...

  unit            TEXT          NOT NULL DEFAULT 'cái',
  qty_in_stock    INTEGER       NOT NULL DEFAULT 0,
  qty_minimum     INTEGER       NOT NULL DEFAULT 1,

  price_cost      INTEGER       NOT NULL DEFAULT 0,   -- chi phí nhập/mua quà

  -- Gắn với chương trình khuyến mãi nào? (nullable = dùng chung)
  campaign_id     UUID,
  valid_from      DATE,
  valid_until     DATE,

  compatible_models TEXT[],
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

CREATE INDEX IF NOT EXISTS idx_gift_items_category   ON gift_items(category);
CREATE INDEX IF NOT EXISTS idx_gift_items_low_stock  ON gift_items(qty_in_stock)
  WHERE qty_in_stock <= qty_minimum;

-- ============================================================
-- 3. BẢNG MỚI: item_movements (phiếu nhập/xuất phụ kiện & quà)
-- Thiết kế: cùng pattern với stock_movements (spare_parts)
-- KHÔNG dùng chung bảng với stock_movements để tránh phức tạp hóa
-- ============================================================
CREATE TABLE IF NOT EXISTS item_movements (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Đối tượng: phụ kiện HOẶC quà tặng (check constraint đảm bảo chỉ 1 trong 2)
  item_type       TEXT          NOT NULL CHECK (item_type IN ('accessory', 'gift')),
  item_id         UUID          NOT NULL,   -- FK tới accessories.id hoặc gift_items.id

  movement_type   TEXT          NOT NULL CHECK (
    movement_type IN (
      'import',         -- nhập kho từ nhà cung cấp
      'export_sale',    -- xuất bán lẻ
      'export_gift',    -- xuất tặng kèm xe
      'export_warranty',-- xuất phục vụ bảo hành
      'adjust_plus',    -- kiểm kê điều chỉnh tăng
      'adjust_minus',   -- kiểm kê điều chỉnh giảm
      'return'          -- trả nhà cung cấp
    )
  ),

  quantity        INTEGER       NOT NULL CHECK (quantity != 0), -- dương = vào, âm = ra
  unit_cost       INTEGER       NOT NULL DEFAULT 0,             -- đơn giá tại thời điểm xuất/nhập

  -- Liên kết nghiệp vụ (tuỳ chọn)
  order_id        UUID,         -- nếu export_gift hoặc export_sale liên quan đơn hàng
  reference_code  TEXT,         -- mã phiếu nhập/xuất nội bộ
  supplier        TEXT,
  note            TEXT,

  created_by      UUID,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  -- Không có updated_at: movement là immutable sau khi tạo
);

CREATE INDEX IF NOT EXISTS idx_item_movements_item   ON item_movements(item_type, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_movements_order  ON item_movements(order_id) WHERE order_id IS NOT NULL;

-- Trigger: cập nhật qty_in_stock sau mỗi movement
CREATE OR REPLACE FUNCTION update_item_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_type = 'accessory' THEN
    UPDATE accessories
       SET qty_in_stock = qty_in_stock + NEW.quantity,
           updated_at   = NOW()
     WHERE id = NEW.item_id;
  ELSIF NEW.item_type = 'gift' THEN
    UPDATE gift_items
       SET qty_in_stock = qty_in_stock + NEW.quantity,
           updated_at   = NOW()
     WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_item_stock'
  ) THEN
    CREATE TRIGGER trg_update_item_stock
      AFTER INSERT ON item_movements
      FOR EACH ROW EXECUTE FUNCTION update_item_stock();
  END IF;
END $$;

-- ============================================================
-- 4. BẢNG MỚI: order_gifts (quà tặng gắn theo đơn hàng cụ thể)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_gifts (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  order_id        UUID          NOT NULL,   -- FK → sales_orders.id
  gift_item_id    UUID          REFERENCES gift_items(id),
  accessory_id    UUID          REFERENCES accessories(id),

  quantity        INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost       INTEGER       NOT NULL DEFAULT 0,

  -- Loại: quà tặng miễn phí hay bán kèm giá ưu đãi?
  gift_type       TEXT          NOT NULL DEFAULT 'free' CHECK (
    gift_type IN ('free', 'discounted', 'mandatory_bundle')
  ),
  sale_price      INTEGER       NOT NULL DEFAULT 0,   -- 0 nếu miễn phí

  -- Trạng thái xuất kho
  status          TEXT          NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'issued', 'cancelled')
  ),
  issued_at       TIMESTAMPTZ,
  issued_by       UUID,

  note            TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Ràng buộc: phải có đúng 1 trong 2 (gift_item hoặc accessory)
  CONSTRAINT chk_one_item CHECK (
    (gift_item_id IS NOT NULL AND accessory_id IS NULL)
    OR
    (gift_item_id IS NULL AND accessory_id IS NOT NULL)
  )
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_order_gifts_updated_at'
  ) THEN
    CREATE TRIGGER trg_order_gifts_updated_at
      BEFORE UPDATE ON order_gifts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_gifts_order     ON order_gifts(order_id);
CREATE INDEX IF NOT EXISTS idx_order_gifts_gift_item ON order_gifts(gift_item_id) WHERE gift_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_gifts_accessory ON order_gifts(accessory_id) WHERE accessory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_gifts_pending   ON order_gifts(status) WHERE status = 'pending';

-- Trigger: khi order_gift được đánh dấu issued → tự tạo item_movement
CREATE OR REPLACE FUNCTION auto_movement_on_gift_issue()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status != 'issued' AND NEW.status = 'issued' THEN
    IF NEW.gift_item_id IS NOT NULL THEN
      INSERT INTO item_movements (item_type, item_id, movement_type, quantity, unit_cost, order_id, note, created_by)
      VALUES ('gift', NEW.gift_item_id, 'export_gift', -NEW.quantity, NEW.unit_cost, NEW.order_id,
              'Xuất quà tặng cho đơn ' || NEW.order_id::TEXT, NEW.issued_by);
    ELSIF NEW.accessory_id IS NOT NULL THEN
      INSERT INTO item_movements (item_type, item_id, movement_type, quantity, unit_cost, order_id, note, created_by)
      VALUES ('accessory', NEW.accessory_id, 'export_gift', -NEW.quantity, NEW.unit_cost, NEW.order_id,
              'Xuất phụ kiện kèm đơn ' || NEW.order_id::TEXT, NEW.issued_by);
    END IF;
    NEW.issued_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gift_issue_movement'
  ) THEN
    CREATE TRIGGER trg_gift_issue_movement
      BEFORE UPDATE ON order_gifts
      FOR EACH ROW EXECUTE FUNCTION auto_movement_on_gift_issue();
  END IF;
END $$;

-- ============================================================
-- 5. VIEWS
-- ============================================================
CREATE OR REPLACE VIEW v_accessory_stock_alert AS
  SELECT
    id,
    code,
    name,
    category,
    qty_in_stock,
    qty_minimum,
    qty_in_stock - qty_minimum AS surplus,
    CASE
      WHEN qty_in_stock = 0          THEN 'out_of_stock'
      WHEN qty_in_stock < qty_minimum THEN 'low_stock'
      ELSE 'ok'
    END AS stock_status
  FROM accessories
  WHERE is_active = TRUE
  ORDER BY surplus ASC;

CREATE OR REPLACE VIEW v_gift_stock_alert AS
  SELECT
    id,
    code,
    name,
    category,
    qty_in_stock,
    qty_minimum,
    qty_in_stock - qty_minimum AS surplus,
    CASE
      WHEN qty_in_stock = 0          THEN 'out_of_stock'
      WHEN qty_in_stock < qty_minimum THEN 'low_stock'
      ELSE 'ok'
    END AS stock_status
  FROM gift_items
  WHERE is_active = TRUE
  ORDER BY surplus ASC;

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE gift_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_gifts    ENABLE ROW LEVEL SECURITY;

-- RLS accessories (đã có từ schema cũ, thêm nếu chưa bật)
DO $$ BEGIN
  -- check xem RLS đã bật chưa
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'accessories') THEN
    ALTER TABLE accessories ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Helpers: đọc role từ users table (dùng pattern của project)
-- (Hàm get_user_role đã có từ schema.sql hoặc auth middleware)

-- gift_items: warehouse + manager + admin xem/sửa; sales chỉ đọc
-- Dùng DROP ... IF EXISTS trước khi CREATE để đảm bảo idempotent
-- (PostgreSQL không hỗ trợ CREATE POLICY IF NOT EXISTS)
DO $$ BEGIN
  DROP POLICY IF EXISTS "gift_items_warehouse_all" ON gift_items;
  DROP POLICY IF EXISTS "gift_items_sales_read"    ON gift_items;
  DROP POLICY IF EXISTS "item_movements_warehouse_insert" ON item_movements;
  DROP POLICY IF EXISTS "item_movements_staff_read"       ON item_movements;
  DROP POLICY IF EXISTS "order_gifts_all_read"            ON order_gifts;
  DROP POLICY IF EXISTS "order_gifts_sales_insert"        ON order_gifts;
  DROP POLICY IF EXISTS "order_gifts_warehouse_update"    ON order_gifts;
END $$;

CREATE POLICY "gift_items_warehouse_all" ON gift_items
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'warehouse')
    )
  );

CREATE POLICY "gift_items_sales_read" ON gift_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('sales', 'technician', 'accountant')
    )
  );

-- item_movements
CREATE POLICY "item_movements_warehouse_insert" ON item_movements
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'warehouse')
    )
  );

CREATE POLICY "item_movements_staff_read" ON item_movements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid())
  );

-- order_gifts
CREATE POLICY "order_gifts_all_read" ON order_gifts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid())
  );

CREATE POLICY "order_gifts_sales_insert" ON order_gifts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'sales', 'warehouse')
    )
  );

CREATE POLICY "order_gifts_warehouse_update" ON order_gifts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'warehouse')
    )
  );
