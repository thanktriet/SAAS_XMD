-- ============================================================
-- ERP XE MÁY ĐIỆN — FULL SCHEMA (PostgreSQL thuần)
-- Chạy trên PostgreSQL 14+ (không phụ thuộc Supabase)
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- EXTENSIONS
-- ════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- cho crypt() nếu cần hash password ở DB

-- ════════════════════════════════════════════════════════════════
-- FUNCTION: auto updated_at
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════
-- 1. USERS (nhân viên / quản lý)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,  -- bcrypt hash, quản lý ở app layer
  full_name       TEXT NOT NULL,
  phone           TEXT,
  role            TEXT NOT NULL DEFAULT 'sales'
                    CHECK (role IN ('admin','manager','sales','technician','accountant','warehouse')),
  is_active       BOOLEAN DEFAULT true,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 2. VEHICLE_MODELS (danh mục dòng xe)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE vehicle_models (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand                 TEXT NOT NULL,
  model_name            TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN ('xe_may','xe_dap','xe_ba_banh','xe_tay_ga')),
  battery_type          TEXT,
  battery_capacity_kwh  NUMERIC(5,2),
  range_km              INTEGER,
  max_speed_kmh         INTEGER,
  price_cost            NUMERIC(15,2),
  price_sell            NUMERIC(15,2),
  warranty_months       INTEGER DEFAULT 24,
  description           TEXT,
  image_url             TEXT,
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_vehicle_models_brand_model UNIQUE (brand, model_name)
);
CREATE TRIGGER trg_vehicle_models_updated_at BEFORE UPDATE ON vehicle_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 3. VEHICLE_MODEL_COLORS (màu sắc theo dòng xe)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE vehicle_model_colors (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_model_id  UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  color_name        TEXT NOT NULL,
  color_hex         TEXT,
  product_code      TEXT,
  image_url         TEXT,
  is_active         BOOLEAN DEFAULT true,
  sort_order        INTEGER DEFAULT 0,
  display_order     INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_vehicle_model_colors UNIQUE (vehicle_model_id, color_name)
);
CREATE INDEX idx_vmc_model ON vehicle_model_colors(vehicle_model_id);
CREATE UNIQUE INDEX idx_vmc_product_code ON vehicle_model_colors(product_code)
  WHERE product_code IS NOT NULL;
CREATE INDEX idx_vmc_display_order ON vehicle_model_colors(display_order);
CREATE TRIGGER trg_vmc_updated_at BEFORE UPDATE ON vehicle_model_colors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 4. INVENTORY_VEHICLES (kho xe)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE inventory_vehicles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_model_id  UUID REFERENCES vehicle_models(id),
  vin               TEXT UNIQUE NOT NULL,
  engine_number     TEXT UNIQUE,
  battery_serial    TEXT,
  color             TEXT,
  year_manufacture  INTEGER,
  status            TEXT DEFAULT 'in_stock'
                      CHECK (status IN ('in_stock','sold','reserved','warranty_repair','demo')),
  import_date       DATE,
  import_price      NUMERIC(15,2),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_inventory_vehicles_updated_at BEFORE UPDATE ON inventory_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 5. SPARE_PARTS (phụ tùng / linh kiện)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE spare_parts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  unit          TEXT DEFAULT 'cái',
  qty_in_stock  INTEGER DEFAULT 0,
  qty_minimum   INTEGER DEFAULT 5,
  price_cost    NUMERIC(12,2),
  price_sell    NUMERIC(12,2),
  supplier      TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_spare_parts_updated_at BEFORE UPDATE ON spare_parts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 6. CUSTOMERS (khách hàng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE customers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_code         TEXT UNIQUE,
  full_name             TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  email                 TEXT,
  gender                TEXT CHECK (gender IN ('male','female','other')),
  source                TEXT CHECK (source IN ('referral','facebook','zalo','showroom','website','call_center','other')),
  id_card               TEXT,
  id_card_date          DATE,
  id_card_place         TEXT,
  date_of_birth         DATE,
  address               TEXT,
  province              TEXT,
  district              TEXT,
  customer_type         TEXT DEFAULT 'individual' CHECK (customer_type IN ('individual','business')),
  company_name          TEXT,
  tax_code              TEXT,
  representative_name   TEXT,
  representative_title  TEXT,
  invoice_address       TEXT,
  invoice_district      TEXT,
  invoice_province      TEXT,
  salesperson_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  loyalty_points        INTEGER DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_customers_salesperson ON customers(salesperson_id);
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 7. ACCESSORIES (phụ kiện)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE accessories (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  brand             TEXT,
  category          TEXT CHECK (category IN ('battery','safety','luggage','comfort','weather','decor','other')),
  unit              TEXT NOT NULL DEFAULT 'cái',
  qty_in_stock      INTEGER NOT NULL DEFAULT 0,
  qty_minimum       INTEGER NOT NULL DEFAULT 3,
  price_cost        INTEGER NOT NULL DEFAULT 0,
  price_sell        INTEGER NOT NULL DEFAULT 0,
  compatible_models TEXT[],
  supplier          TEXT,
  image_url         TEXT,
  note              TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_accessories_category ON accessories(category);
CREATE INDEX idx_accessories_low_stock ON accessories(qty_in_stock) WHERE qty_in_stock <= 3;
CREATE TRIGGER trg_accessories_updated_at BEFORE UPDATE ON accessories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-gen code
CREATE OR REPLACE FUNCTION fn_gen_accessory_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := 'PK' || LPAD(nextval('seq_accessory_code')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE SEQUENCE IF NOT EXISTS seq_accessory_code START 1;
CREATE TRIGGER trg_accessory_code BEFORE INSERT ON accessories
  FOR EACH ROW EXECUTE FUNCTION fn_gen_accessory_code();

-- ════════════════════════════════════════════════════════════════
-- 8. GIFT_ITEMS (quà tặng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE gift_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  gift_type         TEXT NOT NULL DEFAULT 'physical' CHECK (gift_type IN ('physical','voucher','insurance')),
  category          TEXT,
  unit              TEXT NOT NULL DEFAULT 'cái',
  qty_in_stock      INTEGER NOT NULL DEFAULT 0,
  qty_minimum       INTEGER NOT NULL DEFAULT 0,
  cost_value        INTEGER NOT NULL DEFAULT 0,
  retail_value      INTEGER NOT NULL DEFAULT 0,
  campaign_id       UUID,
  applicable_models TEXT[],
  voucher_service   TEXT,
  expiry_months     SMALLINT,
  supplier          TEXT,
  image_url         TEXT,
  note              TEXT,
  display_order     INTEGER,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_gift_items_type ON gift_items(gift_type);
CREATE INDEX idx_gift_items_campaign ON gift_items(campaign_id);
CREATE INDEX idx_gift_items_display_order ON gift_items(display_order);
CREATE TRIGGER trg_gift_items_updated_at BEFORE UPDATE ON gift_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-gen code
CREATE OR REPLACE FUNCTION fn_gen_gift_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := 'QT' || LPAD(nextval('seq_gift_code')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE SEQUENCE IF NOT EXISTS seq_gift_code START 1;
CREATE TRIGGER trg_gift_code BEFORE INSERT ON gift_items
  FOR EACH ROW EXECUTE FUNCTION fn_gen_gift_code();
