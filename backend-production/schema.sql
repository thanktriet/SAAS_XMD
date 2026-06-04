-- ============================================
-- MIGRATION SQL - Chạy trong Supabase SQL Editor
-- ERP Xe Máy Điện - Toàn bộ schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- BẢNG: users (nhân viên / quản lý)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'sales', 'technician', 'accountant', 'warehouse')),
  is_active BOOLEAN DEFAULT true,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: vehicle_models (danh mục dòng xe)
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand TEXT NOT NULL,          -- VinFast, Yamaha, Honda, Yadea, ...
  model_name TEXT NOT NULL,     -- VF 5, VF 6, Latte, ...
  category TEXT NOT NULL CHECK (category IN ('xe_may', 'xe_dap', 'xe_ba_banh', 'xe_tay_ga')),
  battery_type TEXT,            -- LFP, NMC, ...
  battery_capacity_kwh NUMERIC(5,2),
  range_km INTEGER,             -- km mỗi lần sạc
  max_speed_kmh INTEGER,
  price_cost NUMERIC(15,2),     -- giá nhập
  price_sell NUMERIC(15,2),     -- giá bán lẻ
  warranty_months INTEGER DEFAULT 24,
  description TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_vehicle_models_brand_model UNIQUE (brand, model_name)
);

-- ============================================
-- BẢNG: vehicle_model_colors (màu sắc theo dòng xe)
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_model_colors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_model_id UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,           -- Đen, Đỏ, Xanh Oliu, Trắng Ngọc Trai, ...
  color_hex TEXT,                     -- mã HEX (#RRGGBB), tùy chọn
  image_url TEXT,                     -- ảnh xe theo màu, tùy chọn
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_vehicle_model_colors UNIQUE (vehicle_model_id, color_name)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_model_colors_model
  ON vehicle_model_colors(vehicle_model_id);

-- Đảm bảo unique constraint tồn tại (an toàn khi DB cũ chưa có)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_vehicle_models_brand_model'
  ) THEN
    ALTER TABLE vehicle_models
      ADD CONSTRAINT uq_vehicle_models_brand_model UNIQUE (brand, model_name);
  END IF;
END $$;

-- ============================================
-- BẢNG: inventory_vehicles (kho xe)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_model_id UUID REFERENCES vehicle_models(id),
  vin TEXT UNIQUE NOT NULL,     -- số khung
  engine_number TEXT UNIQUE,   -- số máy / số motor
  battery_serial TEXT,
  color TEXT,
  year_manufacture INTEGER,
  status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'reserved', 'warranty_repair', 'demo')),
  import_date DATE,
  import_price NUMERIC(15,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: spare_parts (phụ tùng / linh kiện)
-- ============================================
CREATE TABLE IF NOT EXISTS spare_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,               -- pin, lốp, đèn, phanh, ...
  unit TEXT DEFAULT 'cái',
  qty_in_stock INTEGER DEFAULT 0,
  qty_minimum INTEGER DEFAULT 5,  -- cảnh báo tồn tối thiểu
  price_cost NUMERIC(12,2),
  price_sell NUMERIC(12,2),
  supplier TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: customers (khách hàng)
-- ============================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_code TEXT UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  id_card TEXT,                -- CCCD/CMND
  date_of_birth DATE,
  address TEXT,
  province TEXT,
  district TEXT,
  customer_type TEXT DEFAULT 'individual' CHECK (customer_type IN ('individual', 'business')),
  company_name TEXT,
  tax_code TEXT,
  notes TEXT,
  loyalty_points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: sales_orders (đơn bán hàng)
-- ============================================
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  salesperson_id UUID REFERENCES users(id),
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'confirmed', 'deposit_paid', 'full_paid',
    'invoice_requested', 'invoice_approved',
    'pdi_pending', 'pdi_done',
    'delivered', 'cancelled'
  )),
  subtotal NUMERIC(15,2) DEFAULT 0,
  discount_amount NUMERIC(15,2) DEFAULT 0,
  tax_amount NUMERIC(15,2) DEFAULT 0,
  total_amount NUMERIC(15,2) DEFAULT 0,
  deposit_amount NUMERIC(15,2) DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank_transfer', 'qr', 'installment', 'mixed')),
  -- Thông tin phiếu thu (điền khi full_paid)
  receipt_number TEXT,
  receipt_date DATE,
  payment_note TEXT,
  -- Thông tin PDI kỹ thuật
  pdi_notes TEXT,
  technician_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Duyệt hoá đơn
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Huỷ đơn
  cancel_reason TEXT,
  delivery_date DATE,
  delivery_address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: sales_order_items (chi tiết đơn hàng)
-- ============================================
CREATE TABLE IF NOT EXISTS sales_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
  inventory_vehicle_id UUID REFERENCES inventory_vehicles(id),
  vehicle_model_id UUID REFERENCES vehicle_models(id),
  quantity INTEGER DEFAULT 1,
  unit_price NUMERIC(15,2),
  discount_percent NUMERIC(5,2) DEFAULT 0,
  line_total NUMERIC(15,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: warranty_records (phiếu bảo hành)
-- ============================================
CREATE TABLE IF NOT EXISTS warranty_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warranty_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  inventory_vehicle_id UUID REFERENCES inventory_vehicles(id),
  sales_order_id UUID REFERENCES sales_orders(id),
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'voided')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: service_requests (yêu cầu sửa chữa / bảo dưỡng)
-- ============================================
CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  inventory_vehicle_id UUID REFERENCES inventory_vehicles(id),
  warranty_record_id UUID REFERENCES warranty_records(id),
  technician_id UUID REFERENCES users(id),
  service_type TEXT CHECK (service_type IN ('warranty', 'paid_repair', 'maintenance', 'inspection')),
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'diagnosing', 'waiting_parts', 'repairing', 'done', 'delivered', 'cancelled')),
  symptom TEXT,
  diagnosis TEXT,
  work_done TEXT,
  odometer_km INTEGER,
  battery_health_percent NUMERIC(5,2),
  received_date TIMESTAMPTZ DEFAULT NOW(),
  completed_date TIMESTAMPTZ,
  labor_cost NUMERIC(12,2) DEFAULT 0,
  parts_cost NUMERIC(12,2) DEFAULT 0,
  total_cost NUMERIC(12,2) DEFAULT 0,
  is_warranty_claim BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: service_parts_used (phụ tùng dùng trong sửa chữa)
-- ============================================
CREATE TABLE IF NOT EXISTS service_parts_used (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_request_id UUID REFERENCES service_requests(id) ON DELETE CASCADE,
  spare_part_id UUID REFERENCES spare_parts(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2),
  is_warranty_covered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: finance_transactions (thu chi tài chính)
-- ============================================
CREATE TABLE IF NOT EXISTS finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL,      -- ban_hang, bao_hanh, mua_hang, luong, dien_nuoc, ...
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'VND',
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank_transfer', 'card')),
  reference_id UUID,           -- ID đơn hàng / phiếu dịch vụ liên quan
  reference_type TEXT,         -- 'sales_order' / 'service_request'
  description TEXT,
  transaction_date DATE DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BẢNG: stock_movements (lịch sử nhập/xuất kho phụ tùng)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  spare_part_id UUID REFERENCES spare_parts(id),
  movement_type TEXT CHECK (movement_type IN ('import', 'export', 'adjustment')),
  quantity INTEGER NOT NULL,
  quantity_before INTEGER,
  quantity_after INTEGER,
  reference_id UUID,
  reference_type TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- VIEWS hữu ích
-- ============================================

-- Tồn kho xe theo dòng xe
DROP VIEW IF EXISTS v_vehicle_stock_summary;
CREATE VIEW v_vehicle_stock_summary AS
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
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense,
  SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS net_profit
FROM finance_transactions
GROUP BY DATE_TRUNC('month', transaction_date)
ORDER BY month DESC;

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;

-- Policy: Cho phép authenticated users đọc
DROP POLICY IF EXISTS "Allow authenticated read" ON customers;
DROP POLICY IF EXISTS "Allow authenticated read" ON sales_orders;
DROP POLICY IF EXISTS "Allow authenticated read" ON inventory_vehicles;
CREATE POLICY "Allow authenticated read" ON customers          FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON sales_orders       FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON inventory_vehicles FOR SELECT TO authenticated USING (true);

-- ============================================
-- Functions tự động
-- ============================================

-- Tự cập nhật updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Gắn trigger cho các bảng
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','vehicle_models','vehicle_model_colors','inventory_vehicles','spare_parts','customers','sales_orders','warranty_records','service_requests','finance_transactions'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_updated_at ON %I;
      CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t);
  END LOOP;
END;
$$;

-- Tự sinh mã số tồn kho phụ tùng sau khi thêm/xóa
CREATE OR REPLACE FUNCTION update_spare_part_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE spare_parts
    SET qty_in_stock = qty_in_stock + CASE WHEN NEW.movement_type = 'import' THEN NEW.quantity ELSE -NEW.quantity END
    WHERE id = NEW.spare_part_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movement ON stock_movements;
CREATE TRIGGER trg_stock_movement
AFTER INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION update_spare_part_stock();
