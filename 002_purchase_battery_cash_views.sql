-- ============================================================
-- ERP XE MÁY ĐIỆN — PHẦN 3: Purchase Orders, Battery, Cash, Views
-- Chạy SAU 001_sales_finance_service.sql
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 30. PURCHASE_ORDERS (đơn mua hàng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE purchase_orders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number               TEXT UNIQUE NOT NULL,
  supplier_name           TEXT NOT NULL,
  supplier_phone          TEXT,
  supplier_address        TEXT,
  item_type               TEXT NOT NULL DEFAULT 'vehicle'
                            CHECK (item_type IN ('vehicle','spare_part','accessory')),
  order_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date           DATE,
  actual_date             DATE,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','submitted','approved','partial_received','fully_received','invoiced','paid','rejected','cancelled')),
  subtotal                NUMERIC(18,0) NOT NULL DEFAULT 0,
  vat_amount              NUMERIC(18,0) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(18,0) NOT NULL DEFAULT 0,
  paid_amount             NUMERIC(18,0) NOT NULL DEFAULT 0,
  balance_due             NUMERIC(18,0) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  payment_terms           SMALLINT DEFAULT 30,
  payment_due_date        DATE,
  payment_method          TEXT CHECK (payment_method IN ('cash','bank_transfer','check','mixed')),
  supplier_invoice_number TEXT,
  supplier_invoice_date   DATE,
  supplier_invoice_url    TEXT,
  warehouse_note          TEXT,
  notes                   TEXT,
  cancel_reason           TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_po_paid CHECK (paid_amount <= total_amount)
);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_item_type ON purchase_orders(item_type);
CREATE INDEX idx_po_date ON purchase_orders(order_date DESC);
CREATE INDEX idx_po_due ON purchase_orders(payment_due_date) WHERE payment_due_date IS NOT NULL;
CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-gen po_number
CREATE SEQUENCE IF NOT EXISTS seq_po_number START 1;
CREATE OR REPLACE FUNCTION fn_gen_po_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    NEW.po_number := 'PO' || TO_CHAR(NOW(), 'YYYY') || LPAD(nextval('seq_po_number')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_po_number BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fn_gen_po_number();

-- ════════════════════════════════════════════════════════════════
-- 31. PURCHASE_ORDER_ITEMS (chi tiết đơn mua)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE purchase_order_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id               UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number         SMALLINT NOT NULL DEFAULT 1,
  item_type           TEXT NOT NULL DEFAULT 'vehicle'
                        CHECK (item_type IN ('vehicle','spare_part','accessory')),
  vehicle_model_id    UUID REFERENCES vehicle_models(id) ON DELETE RESTRICT,
  color               TEXT,
  year_manufacture    SMALLINT,
  spare_part_id       UUID REFERENCES spare_parts(id) ON DELETE RESTRICT,
  accessory_id        UUID REFERENCES accessories(id) ON DELETE RESTRICT,
  item_name           TEXT,
  qty_ordered         INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received        INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_rejected        INTEGER NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  qty_pending         INTEGER GENERATED ALWAYS AS (qty_ordered - qty_received - qty_rejected) STORED,
  unit_cost           NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  vat_rate            NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  vat_amount          NUMERIC(18,0) GENERATED ALWAYS AS (ROUND(unit_cost * qty_ordered * vat_rate / 100)) STORED,
  line_total          NUMERIC(18,0) GENERATED ALWAYS AS (unit_cost * qty_ordered) STORED,
  line_total_with_vat NUMERIC(18,0) GENERATED ALWAYS AS (ROUND(unit_cost * qty_ordered * (1 + vat_rate / 100))) STORED,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_poi_line UNIQUE(po_id, line_number),
  CONSTRAINT chk_poi_qty CHECK (qty_received + qty_rejected <= qty_ordered)
);
CREATE INDEX idx_poi_po ON purchase_order_items(po_id);
CREATE INDEX idx_poi_item_type ON purchase_order_items(item_type);
CREATE INDEX idx_poi_model ON purchase_order_items(vehicle_model_id) WHERE vehicle_model_id IS NOT NULL;
CREATE INDEX idx_poi_spare_part ON purchase_order_items(spare_part_id) WHERE spare_part_id IS NOT NULL;
CREATE INDEX idx_poi_accessory ON purchase_order_items(accessory_id) WHERE accessory_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 32. PURCHASE_RECEIPTS (phiếu nhận hàng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE purchase_receipts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  receipt_number  TEXT UNIQUE NOT NULL,
  receipt_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','inspecting','accepted','rejected')),
  received_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  inspected_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  inspection_notes TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pr_po ON purchase_receipts(po_id);
CREATE INDEX idx_pr_date ON purchase_receipts(receipt_date DESC);
CREATE INDEX idx_pr_status ON purchase_receipts(status);
CREATE TRIGGER trg_pr_updated_at BEFORE UPDATE ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-gen receipt_number
CREATE SEQUENCE IF NOT EXISTS seq_receipt_number START 1;
CREATE OR REPLACE FUNCTION fn_gen_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    NEW.receipt_number := 'PN' || TO_CHAR(NOW(), 'YYYY') || LPAD(nextval('seq_receipt_number')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_receipt_number BEFORE INSERT ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_gen_receipt_number();

-- ════════════════════════════════════════════════════════════════
-- 33. PURCHASE_RECEIPT_ITEMS (chi tiết phiếu nhận)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE purchase_receipt_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id            UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  po_item_id            UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  line_number           SMALLINT NOT NULL DEFAULT 1,
  item_type             TEXT NOT NULL DEFAULT 'vehicle'
                          CHECK (item_type IN ('vehicle','spare_part','accessory')),
  vin                   TEXT,
  engine_number         TEXT,
  battery_serial        TEXT,
  color                 TEXT,
  year_manufacture      SMALLINT,
  qty_received          INTEGER DEFAULT 1 CHECK (qty_received > 0),
  condition             TEXT NOT NULL DEFAULT 'ok' CHECK (condition IN ('ok','defect','rejected')),
  defect_notes          TEXT,
  inventory_vehicle_id  UUID REFERENCES inventory_vehicles(id) ON DELETE SET NULL,
  actual_unit_cost      NUMERIC(18,0),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_pri_line UNIQUE(receipt_id, line_number)
);
CREATE INDEX idx_pri_receipt ON purchase_receipt_items(receipt_id);
CREATE INDEX idx_pri_po_item ON purchase_receipt_items(po_item_id);
CREATE INDEX idx_pri_vin ON purchase_receipt_items(vin) WHERE vin IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 34. PO_PAYMENTS (thanh toán đơn mua)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE po_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  payment_number  TEXT UNIQUE NOT NULL,
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  amount          NUMERIC(18,0) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','check')),
  bank_reference  TEXT,
  note            TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pop_po ON po_payments(po_id);
CREATE INDEX idx_pop_date ON po_payments(payment_date DESC);

-- Auto-gen payment_number
CREATE SEQUENCE IF NOT EXISTS seq_po_payment_number START 1;
CREATE OR REPLACE FUNCTION fn_gen_po_payment_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_number IS NULL OR NEW.payment_number = '' THEN
    NEW.payment_number := 'TT' || TO_CHAR(NOW(), 'YYYY') || LPAD(nextval('seq_po_payment_number')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_po_payment_number BEFORE INSERT ON po_payments
  FOR EACH ROW EXECUTE FUNCTION fn_gen_po_payment_number();

-- Trigger: cập nhật paid_amount trên purchase_orders
CREATE OR REPLACE FUNCTION fn_po_paid_amount()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE purchase_orders
  SET paid_amount = COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = NEW.po_id), 0)
  WHERE id = NEW.po_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_po_paid_amount AFTER INSERT OR DELETE ON po_payments
  FOR EACH ROW EXECUTE FUNCTION fn_po_paid_amount();

-- ════════════════════════════════════════════════════════════════
-- 35. ACCESSORY_ORDERS (đơn bán phụ kiện độc lập)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE accessory_orders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_code              TEXT UNIQUE NOT NULL,
  customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name           TEXT,
  customer_phone          TEXT,
  subtotal                NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method          TEXT NOT NULL CHECK (payment_method IN ('qr_sepay','cash')),
  payment_status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (payment_status IN ('pending','paid','cancelled')),
  sepay_transaction_id    TEXT,
  finance_transaction_id  UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,
  paid_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                   TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_accessory_orders_status ON accessory_orders(payment_status);
CREATE INDEX idx_accessory_orders_customer ON accessory_orders(customer_id);
CREATE INDEX idx_accessory_orders_created_at ON accessory_orders(created_at DESC);
CREATE TRIGGER trg_accessory_orders_updated_at BEFORE UPDATE ON accessory_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 36. ACCESSORY_ORDER_ITEMS (chi tiết đơn phụ kiện)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE accessory_order_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES accessory_orders(id) ON DELETE CASCADE,
  accessory_id    UUID NOT NULL REFERENCES accessories(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(15,2) NOT NULL,
  line_total      NUMERIC(15,2) NOT NULL,
  serial_numbers  TEXT[],
  assignment_type TEXT CHECK (assignment_type IS NULL OR assignment_type IN ('purchase','rent')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_accessory_order_items_order ON accessory_order_items(order_id);

-- ════════════════════════════════════════════════════════════════
-- 37. BATTERY_ASSIGNMENTS (track pin đã giao)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE battery_assignments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  accessory_id      UUID NOT NULL REFERENCES accessories(id),
  serial_number     TEXT NOT NULL,
  assignment_type   TEXT NOT NULL CHECK (assignment_type IN ('purchase','rent')),
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_vin       TEXT,
  vehicle_id        UUID REFERENCES inventory_vehicles(id) ON DELETE SET NULL,
  source_type       TEXT CHECK (source_type IN ('sales_order','accessory_order','battery_rental')),
  source_id         UUID,
  status            TEXT NOT NULL DEFAULT 'assigned'
                      CHECK (status IN ('assigned','returned')),
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at       TIMESTAMPTZ,
  returned_to_stock BOOLEAN NOT NULL DEFAULT false,
  return_reason     TEXT,
  notes             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_battery_serial_active ON battery_assignments(serial_number)
  WHERE status = 'assigned';
CREATE INDEX idx_battery_assignments_customer ON battery_assignments(customer_id);
CREATE INDEX idx_battery_assignments_source ON battery_assignments(source_type, source_id);
CREATE INDEX idx_battery_assignments_vehicle ON battery_assignments(vehicle_vin)
  WHERE vehicle_vin IS NOT NULL;
CREATE TRIGGER trg_battery_assignments_updated_at BEFORE UPDATE ON battery_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 38. BATTERY_RENTALS (phiếu thuê pin độc lập)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE battery_rentals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rental_code     TEXT UNIQUE NOT NULL,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name   TEXT,
  customer_phone  TEXT,
  vehicle_vin     TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','completed','cancelled')),
  notes           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_battery_rentals_status ON battery_rentals(status);
CREATE INDEX idx_battery_rentals_customer ON battery_rentals(customer_id);
CREATE TRIGGER trg_battery_rentals_updated_at BEFORE UPDATE ON battery_rentals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 39. CASH_ADVANCES (phiếu chi tiền mặt)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE cash_advances (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_code            TEXT UNIQUE NOT NULL,
  purpose                 TEXT NOT NULL,
  amount_requested        NUMERIC(15,2) NOT NULL CHECK (amount_requested > 0),
  sales_order_id          UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','completed','reconciled','cancelled')),
  requested_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at             TIMESTAMPTZ,
  reject_reason           TEXT,
  amount_actual           NUMERIC(15,2),
  receipt_number          TEXT,
  receipt_date            DATE,
  receipt_image_url       TEXT,
  completed_at            TIMESTAMPTZ,
  reconciled_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at           TIMESTAMPTZ,
  finance_transaction_id  UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cash_advances_status ON cash_advances(status);
CREATE INDEX idx_cash_advances_sales_order ON cash_advances(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX idx_cash_advances_requested_by ON cash_advances(requested_by);
CREATE TRIGGER trg_cash_advances_updated_at BEFORE UPDATE ON cash_advances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 40. CASH_DEPOSITS (phiếu nộp tiền mặt về ngân hàng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE cash_deposits (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deposit_code            TEXT UNIQUE NOT NULL,
  amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  bank_name               TEXT NOT NULL,
  bank_account            TEXT NOT NULL,
  bank_account_name       TEXT,
  deposit_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_number          TEXT,
  receipt_image_url       TEXT,
  finance_transaction_id  UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  notes                   TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cash_deposits_date ON cash_deposits(deposit_date DESC);
CREATE TRIGGER trg_cash_deposits_updated_at BEFORE UPDATE ON cash_deposits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- VIEWS
-- ════════════════════════════════════════════════════════════════

-- Tồn kho xe theo dòng xe
CREATE OR REPLACE VIEW v_vehicle_stock_summary AS
SELECT
  vm.id            AS model_id,
  vm.brand,
  vm.model_name,
  vm.category,
  vm.price_sell,
  vm.image_url,
  COUNT(iv.id)                                               AS total,
  COUNT(CASE WHEN iv.status = 'in_stock'        THEN 1 END) AS in_stock,
  COUNT(CASE WHEN iv.status = 'sold'            THEN 1 END) AS sold,
  COUNT(CASE WHEN iv.status = 'reserved'        THEN 1 END) AS reserved,
  COUNT(CASE WHEN iv.status = 'warranty_repair' THEN 1 END) AS warranty_repair
FROM vehicle_models vm
LEFT JOIN inventory_vehicles iv ON iv.vehicle_model_id = vm.id
GROUP BY vm.id, vm.brand, vm.model_name, vm.category, vm.price_sell, vm.image_url;

-- Doanh thu theo tháng
CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT
  DATE_TRUNC('month', transaction_date) AS month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END)    AS total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)   AS total_expense,
  SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS net_profit
FROM finance_transactions
GROUP BY DATE_TRUNC('month', transaction_date)
ORDER BY month DESC;

-- Tổng thanh toán theo đơn
CREATE OR REPLACE VIEW v_order_payment_summary AS
SELECT
  o.id                                                                    AS order_id,
  o.order_number,
  o.total_amount,
  COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0)        AS total_paid,
  COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'), 0)          AS total_pending,
  o.total_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0) AS remaining
FROM sales_orders o
LEFT JOIN sales_order_payments p ON p.order_id = o.id
GROUP BY o.id, o.order_number, o.total_amount;

-- Khuyến mãi đang hoạt động
CREATE OR REPLACE VIEW v_active_promotions AS
SELECT
  p.*,
  gi.name     AS gift_item_name,
  gi.code     AS gift_item_code,
  gi.category AS gift_item_category
FROM promotions p
LEFT JOIN gift_items gi ON gi.id = p.gift_item_id
WHERE p.is_active = true
  AND CURRENT_DATE BETWEEN p.valid_from AND p.valid_until
  AND (p.usage_limit IS NULL OR p.usage_count < p.usage_limit);

-- ════════════════════════════════════════════════════════════════
-- SEED DATA (dữ liệu mặc định)
-- ════════════════════════════════════════════════════════════════

-- Phí cố định
INSERT INTO fee_settings (key, label, amount, sort_order) VALUES
  ('phi_truoc_ba',    'Phí trước bạ',       500000, 1),
  ('phi_bien_so',     'Phí biển số xe',      150000, 2),
  ('phi_kiem_dinh',   'Phí kiểm định',            0, 3),
  ('phi_duong_bo',    'Phí đường bộ (năm)',  180000, 4),
  ('phi_bao_hiem_bb', 'Bảo hiểm bắt buộc',   66000, 5)
ON CONFLICT DO NOTHING;

-- Dịch vụ đăng ký
INSERT INTO registration_services (name, description, price, sort_order) VALUES
  ('Đăng ký biển số nhanh',     'Hỗ trợ đăng ký biển số tại cơ quan có thẩm quyền', 200000, 1),
  ('Làm đăng kiểm lần đầu',    'Kiểm tra kỹ thuật và đăng kiểm xe mới',             150000, 2),
  ('Giao xe tận nhà (nội ô)',   'Giao xe trong bán kính 10km',                         50000, 3),
  ('Giao xe tận nhà (ngoại ô)', 'Giao xe từ 10–30km',                                100000, 4)
ON CONFLICT DO NOTHING;

-- Cấu hình thanh toán
INSERT INTO payment_settings (key, value, label) VALUES
  ('bank_code',               'TCB',        'Mã ngân hàng SEPay'),
  ('bank_name',               'Techcombank','Tên ngân hàng hiển thị'),
  ('bank_account',            '',           'Số tài khoản thụ hưởng'),
  ('bank_account_name',       '',           'Tên chủ tài khoản'),
  ('sepay_api_key',           '',           'API Key SEPay'),
  ('max_cash_allowed',        '50000000',   'Ngưỡng cảnh báo tồn quỹ tiền mặt (VND)'),
  ('loyalty_amount_per_point','10000',      'Số tiền (VNĐ) ứng với 1 điểm tích lũy'),
  ('loyalty_enabled',         'true',       'Bật/tắt tích điểm khi KH chi tiêu')
ON CONFLICT (key) DO NOTHING;

-- Đơn vị trả góp mẫu
INSERT INTO installment_providers (name, interest_rate_per_month, available_months, default_months, min_down_payment_percent, sort_order) VALUES
  ('FE Credit',       1.5, ARRAY[6,12,18,24,36],  12, 30, 1),
  ('HD SAISON',       1.4, ARRAY[6,12,18,24,36],  12, 20, 2),
  ('Mirae Asset',     1.3, ARRAY[12,18,24,36],    12, 25, 3),
  ('Home Credit',     1.6, ARRAY[6,12,18,24],     12, 30, 4),
  ('VPBank Trả Góp',  1.0, ARRAY[12,24,36,48],    24, 20, 5)
ON CONFLICT DO NOTHING;

-- Admin mặc định (password: admin123 — bcrypt hash)
-- Đổi password ngay sau khi deploy!
INSERT INTO users (email, password_hash, full_name, role) VALUES
  ('admin@erp.local', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkf9.iqHWzCFGYkLPBMx/ScLz7uSi', 'Admin', 'admin')
ON CONFLICT (email) DO NOTHING;
