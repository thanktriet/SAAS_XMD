-- =============================================================================
-- Migration: Quản lý pin xe — phân biệt mua đứt vs thuê pin
--   1. Bảng battery_assignments — track từng cục pin đã giao
--   2. Bảng battery_rentals — phiếu thuê/trả pin độc lập (không qua đơn bán)
-- =============================================================================

-- ── 1. battery_assignments — sử dụng cho cả 3 nguồn ───────────────────────────
--    sales_order (mua/thuê pin trong đơn bán xe)
--    accessory_order (mua/thuê pin trong đơn phụ kiện)
--    battery_rental (thuê pin độc lập, không qua đơn bán)
CREATE TABLE IF NOT EXISTS battery_assignments (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Liên kết tới phụ kiện trong kho (category=battery)
  accessory_id    UUID          NOT NULL REFERENCES accessories(id),
  serial_number   TEXT          NOT NULL,

  -- 'purchase' = mua đứt (đại lý thu tiền)
  -- 'rent'     = thuê (VinFast thu, đại lý chỉ giao)
  assignment_type TEXT          NOT NULL CHECK (assignment_type IN ('purchase', 'rent')),

  -- Khách hàng nhận pin
  customer_id     UUID          REFERENCES customers(id) ON DELETE SET NULL,

  -- VIN xe gắn pin (nullable vì có thể giao pin rời)
  vehicle_vin     TEXT,
  vehicle_id      UUID          REFERENCES inventory_vehicles(id) ON DELETE SET NULL,

  -- Nguồn phát sinh
  source_type     TEXT          CHECK (source_type IN ('sales_order', 'accessory_order', 'battery_rental')),
  source_id       UUID,         -- ID đơn bán xe / đơn phụ kiện / phiếu thuê

  -- Lifecycle
  status          TEXT          NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned', 'returned')),
  assigned_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  returned_at     TIMESTAMPTZ,
  returned_to_stock BOOLEAN     NOT NULL DEFAULT FALSE,
  return_reason   TEXT,         -- 'normal_return' | 'warranty_replace' | 'recall' ...

  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_battery_assignments_serial_active
  ON battery_assignments(serial_number) WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS idx_battery_assignments_customer
  ON battery_assignments(customer_id);
CREATE INDEX IF NOT EXISTS idx_battery_assignments_source
  ON battery_assignments(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_battery_assignments_vehicle
  ON battery_assignments(vehicle_vin) WHERE vehicle_vin IS NOT NULL;

COMMENT ON TABLE battery_assignments IS
  'Track từng cục pin đã giao cho KH — phân biệt mua đứt vs thuê. Serial UNIQUE khi status=assigned.';

-- ── 2. battery_rentals — phiếu thuê pin độc lập ───────────────────────────────
CREATE TABLE IF NOT EXISTS battery_rentals (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  rental_code     TEXT          UNIQUE NOT NULL,         -- TP2026XXXXX

  customer_id     UUID          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name   TEXT,
  customer_phone  TEXT,
  vehicle_vin     TEXT,                                  -- xe gắn pin (tùy chọn)

  -- Trạng thái phiếu (riêng từng phiếu, ko phải trạng thái pin)
  status          TEXT          NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed', 'cancelled')),

  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battery_rentals_status
  ON battery_rentals(status);
CREATE INDEX IF NOT EXISTS idx_battery_rentals_customer
  ON battery_rentals(customer_id);

-- ── Trigger updated_at ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_battery_assignments_upd() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_battery_assignments_set_upd ON battery_assignments;
CREATE TRIGGER trg_battery_assignments_set_upd
  BEFORE UPDATE ON battery_assignments
  FOR EACH ROW EXECUTE FUNCTION trg_battery_assignments_upd();

DROP TRIGGER IF EXISTS trg_battery_rentals_set_upd ON battery_rentals;
CREATE TRIGGER trg_battery_rentals_set_upd
  BEFORE UPDATE ON battery_rentals
  FOR EACH ROW EXECUTE FUNCTION trg_battery_assignments_upd();

COMMENT ON COLUMN battery_assignments.assignment_type IS
  'purchase = mua đứt (đại lý thu tiền, giảm tồn kho); rent = thuê (VinFast thu, giảm tồn kho)';
COMMENT ON COLUMN battery_assignments.returned_to_stock IS
  'TRUE nếu khi trả pin thì pin được nhập lại kho đại lý (vd thuê → trả). FALSE nếu pin chuyển sang trạng thái khác (vd warranty)';

-- ── 3. Thêm cột serial_numbers + assignment_type vào order_items ──────────────
ALTER TABLE accessory_order_items
  ADD COLUMN IF NOT EXISTS serial_numbers   TEXT[],
  ADD COLUMN IF NOT EXISTS assignment_type  TEXT
    CHECK (assignment_type IS NULL OR assignment_type IN ('purchase', 'rent'));

ALTER TABLE sales_order_accessories
  ADD COLUMN IF NOT EXISTS serial_numbers   TEXT[],
  ADD COLUMN IF NOT EXISTS assignment_type  TEXT
    CHECK (assignment_type IS NULL OR assignment_type IN ('purchase', 'rent'));

COMMENT ON COLUMN accessory_order_items.serial_numbers IS
  'Mảng serial pin — chỉ điền khi accessory.category = battery, độ dài phải = quantity';
COMMENT ON COLUMN accessory_order_items.assignment_type IS
  'Loại pin: purchase = mua đứt | rent = thuê (chỉ cho category=battery)';
