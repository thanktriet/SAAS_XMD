-- ============================================================
-- ERP XE MÁY ĐIỆN — PHẦN 2: Sales, Finance, Service, Promotions
-- Chạy SAU 000_full_schema.sql
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 9. PROMOTIONS (khuyến mãi)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE promotions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code              TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT,
  promo_type              TEXT NOT NULL DEFAULT 'percent'
                            CHECK (promo_type IN ('percent','fixed','gift','combo')),
  discount_percent        NUMERIC(5,2) DEFAULT 0,
  discount_amount         NUMERIC(15,2) DEFAULT 0,
  min_order_amount        NUMERIC(15,2) DEFAULT 0,
  max_discount_cap        NUMERIC(15,2),
  valid_from              DATE NOT NULL,
  valid_until             DATE NOT NULL,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  usage_limit             INTEGER,
  usage_count             INTEGER NOT NULL DEFAULT 0,
  applicable_models       TEXT[],
  applicable_brands       TEXT[],
  applies_to              TEXT NOT NULL DEFAULT 'vehicle'
                            CHECK (applies_to IN ('vehicle','accessory','both')),
  applicable_accessories  UUID[],
  gift_item_id            UUID REFERENCES gift_items(id) ON DELETE SET NULL,
  gift_quantity           INTEGER DEFAULT 1,
  display_order           INTEGER,
  note                    TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_promotions_active ON promotions(is_active, valid_from, valid_until);
CREATE INDEX idx_promotions_type ON promotions(promo_type);
CREATE INDEX idx_promotions_display_order ON promotions(display_order);
CREATE TRIGGER trg_promotions_updated_at BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-gen promo_code
CREATE OR REPLACE FUNCTION fn_gen_promo_code()
RETURNS TRIGGER AS $$
DECLARE
  v_prefix TEXT := 'KM' || TO_CHAR(NOW(), 'YYYYMM');
  v_count  INTEGER;
BEGIN
  IF NEW.promo_code IS NULL OR NEW.promo_code = '' THEN
    SELECT COUNT(*) + 1 INTO v_count
      FROM promotions WHERE promo_code LIKE v_prefix || '%';
    NEW.promo_code := v_prefix || LPAD(v_count::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_promo_code BEFORE INSERT ON promotions
  FOR EACH ROW EXECUTE FUNCTION fn_gen_promo_code();

-- ════════════════════════════════════════════════════════════════
-- 10. FEE_SETTINGS (phí cố định)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE fee_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  model_id    UUID REFERENCES vehicle_models(id) ON DELETE CASCADE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fee_settings_model_id ON fee_settings(model_id) WHERE model_id IS NOT NULL;
CREATE TRIGGER trg_fee_settings_updated_at BEFORE UPDATE ON fee_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 11. REGISTRATION_SERVICES (dịch vụ đăng ký xe)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE registration_services (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_registration_services_updated_at BEFORE UPDATE ON registration_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 12. FINANCE_TRANSACTIONS (thu chi tài chính)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE finance_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_number  TEXT UNIQUE NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('income','expense')),
  category            TEXT NOT NULL,
  amount              NUMERIC(15,2) NOT NULL,
  currency            TEXT DEFAULT 'VND',
  payment_method      TEXT CHECK (payment_method IN ('cash','bank_transfer','card','qr_code')),
  reference_id        UUID,
  reference_type      TEXT,
  description         TEXT,
  transaction_date    DATE DEFAULT CURRENT_DATE,
  created_by          UUID REFERENCES users(id),
  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_finance_transactions_updated_at BEFORE UPDATE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 13. SALES_ORDERS (đơn bán hàng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_orders (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number                TEXT UNIQUE NOT NULL,
  customer_id                 UUID REFERENCES customers(id),
  salesperson_id              UUID REFERENCES users(id),
  order_date                  DATE DEFAULT CURRENT_DATE,
  delivery_date               DATE,
  delivery_address            TEXT,
  dms_order_number            TEXT,
  installment_contract_number TEXT,
  status                      TEXT DEFAULT 'draft'
                                CHECK (status IN (
                                  'draft','confirmed','deposit_paid','full_paid',
                                  'invoice_requested','invoice_approved',
                                  'pdi_pending','pdi_done',
                                  'delivered','cancelled'
                                )),
  subtotal                    NUMERIC(15,2) DEFAULT 0,
  discount_amount             NUMERIC(15,2) DEFAULT 0,
  tax_amount                  NUMERIC(15,2) DEFAULT 0,
  total_amount                NUMERIC(15,2) DEFAULT 0,
  deposit_amount              NUMERIC(15,2) DEFAULT 0,
  payment_method              TEXT CHECK (payment_method IN ('cash','bank_transfer','qr','installment','mixed')),
  receipt_number              TEXT,
  receipt_date                DATE,
  payment_note                TEXT,
  pdi_notes                   TEXT,
  technician_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason               TEXT,
  notes                       TEXT,
  loyalty_awarded_at          TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_sales_orders_updated_at BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 14. SALES_ORDER_ITEMS (chi tiết đơn hàng — xe)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_order_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
  inventory_vehicle_id  UUID REFERENCES inventory_vehicles(id),
  vehicle_model_id      UUID REFERENCES vehicle_models(id),
  quantity              INTEGER DEFAULT 1,
  unit_price            NUMERIC(15,2),
  discount_percent      NUMERIC(5,2) DEFAULT 0,
  line_total            NUMERIC(15,2),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- 15. SALES_ORDER_PROMOTIONS (KM áp dụng vào đơn)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_order_promotions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  promotion_id    UUID REFERENCES promotions(id) ON DELETE SET NULL,
  promo_name      TEXT NOT NULL,
  promo_type      TEXT NOT NULL,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  gift_item_id    UUID REFERENCES gift_items(id) ON DELETE SET NULL,
  gift_item_name  TEXT,
  gift_quantity   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- 16. SALES_ORDER_FEES (phí áp dụng vào đơn)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_order_fees (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  fee_key     TEXT NOT NULL,
  fee_label   TEXT NOT NULL,
  amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- 17. SALES_ORDER_SERVICES (dịch vụ đăng ký trong đơn)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_order_services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES registration_services(id) ON DELETE SET NULL,
  service_name  TEXT NOT NULL,
  price         NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- 18. SALES_ORDER_PAYMENTS (thanh toán nhiều lần)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_order_payments (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id                UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  finance_transaction_id  UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  payment_method          TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','qr_code')),
  amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','confirmed','cancelled')),
  receipt_number          TEXT,
  bank_reference          TEXT,
  transfer_screenshot_url TEXT,
  sepay_transaction_id    TEXT,
  notes                   TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sop_order_id ON sales_order_payments(order_id);
CREATE INDEX idx_sop_status ON sales_order_payments(status);
CREATE INDEX idx_sop_payment_method ON sales_order_payments(payment_method);
CREATE UNIQUE INDEX idx_sop_sepay_unique ON sales_order_payments(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX idx_sop_receipt_unique ON sales_order_payments(receipt_number)
  WHERE receipt_number IS NOT NULL AND status != 'cancelled';
CREATE TRIGGER trg_sop_updated_at BEFORE UPDATE ON sales_order_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 19. SALES_ORDER_ATTACHMENTS (đính kèm hồ sơ)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE sales_order_attachments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  storage_name  TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_soa_order_id ON sales_order_attachments(order_id);
CREATE TRIGGER trg_soa_updated_at BEFORE UPDATE ON sales_order_attachments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 20. ORDER_GIFTS (quà tặng trong đơn)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE order_gifts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_order_id  UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  gift_item_id    UUID NOT NULL REFERENCES gift_items(id),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  voucher_code    TEXT UNIQUE,
  voucher_issued_at TIMESTAMPTZ,
  voucher_used_at   TIMESTAMPTZ,
  note            TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_order_gifts_order ON order_gifts(sales_order_id);
CREATE INDEX idx_order_gifts_gift ON order_gifts(gift_item_id);
CREATE INDEX idx_order_gifts_voucher ON order_gifts(voucher_code) WHERE voucher_code IS NOT NULL;

-- Auto-gen voucher_code
CREATE OR REPLACE FUNCTION fn_gen_voucher_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.voucher_code IS NULL THEN
    NEW.voucher_code := 'VC' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
      UPPER(SUBSTR(uuid_generate_v4()::TEXT, 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_order_gift_voucher BEFORE INSERT ON order_gifts
  FOR EACH ROW EXECUTE FUNCTION fn_gen_voucher_code();

-- ════════════════════════════════════════════════════════════════
-- 21. PROMO_USAGE (lịch sử áp dụng KM)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE promo_usage (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_id          UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  order_id          UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  discount_applied  NUMERIC(15,2) NOT NULL DEFAULT 0,
  note              TEXT,
  applied_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(promo_id, order_id)
);
CREATE INDEX idx_promo_usage_order ON promo_usage(order_id);
CREATE INDEX idx_promo_usage_promo ON promo_usage(promo_id);

-- Trigger: tăng/giảm usage_count
CREATE OR REPLACE FUNCTION fn_increment_promo_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE promotions SET usage_count = usage_count + 1 WHERE id = NEW.promo_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_promo_usage_count AFTER INSERT ON promo_usage
  FOR EACH ROW EXECUTE FUNCTION fn_increment_promo_usage();

CREATE OR REPLACE FUNCTION fn_decrement_promo_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE promotions SET usage_count = GREATEST(0, usage_count - 1) WHERE id = OLD.promo_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_promo_usage_count_dec AFTER DELETE ON promo_usage
  FOR EACH ROW EXECUTE FUNCTION fn_decrement_promo_usage();

-- ════════════════════════════════════════════════════════════════
-- 22. ITEM_MOVEMENTS (lịch sử nhập/xuất phụ kiện & quà tặng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE item_movements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_type       TEXT NOT NULL CHECK (item_type IN ('accessory','gift')),
  item_id         UUID NOT NULL,
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('import','export','adjustment','transfer')),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  quantity_before INTEGER,
  quantity_after  INTEGER,
  reference_type  TEXT,
  reference_id    UUID,
  sales_order_id  UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  unit_cost       INTEGER,
  branch_id       UUID,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_item_movements_item ON item_movements(item_type, item_id);
CREATE INDEX idx_item_movements_ref ON item_movements(reference_type, reference_id);
CREATE INDEX idx_item_movements_order ON item_movements(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX idx_item_movements_date ON item_movements(created_at DESC);

-- Trigger: cập nhật tồn kho phụ kiện/quà tặng
CREATE OR REPLACE FUNCTION fn_item_movement_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.item_type = 'accessory' THEN
    UPDATE accessories SET qty_in_stock = qty_in_stock +
      CASE WHEN NEW.movement_type = 'import' THEN NEW.quantity ELSE -NEW.quantity END
    WHERE id = NEW.item_id;
  ELSIF NEW.item_type = 'gift' THEN
    UPDATE gift_items SET qty_in_stock = qty_in_stock +
      CASE WHEN NEW.movement_type = 'import' THEN NEW.quantity ELSE -NEW.quantity END
    WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_item_movement AFTER INSERT ON item_movements
  FOR EACH ROW EXECUTE FUNCTION fn_item_movement_stock();

-- ════════════════════════════════════════════════════════════════
-- 23. STOCK_MOVEMENTS (lịch sử nhập/xuất phụ tùng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  spare_part_id   UUID REFERENCES spare_parts(id),
  movement_type   TEXT CHECK (movement_type IN ('import','export','adjustment')),
  quantity        INTEGER NOT NULL,
  quantity_before INTEGER,
  quantity_after  INTEGER,
  reference_id    UUID,
  reference_type  TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_stock_movement()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE spare_parts
  SET qty_in_stock = qty_in_stock +
    CASE WHEN NEW.movement_type = 'import' THEN NEW.quantity ELSE -NEW.quantity END
  WHERE id = NEW.spare_part_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_stock_movement AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_stock_movement();

-- ════════════════════════════════════════════════════════════════
-- 24. WARRANTY_RECORDS (phiếu bảo hành)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE warranty_records (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warranty_number       TEXT UNIQUE NOT NULL,
  customer_id           UUID REFERENCES customers(id),
  inventory_vehicle_id  UUID REFERENCES inventory_vehicles(id),
  sales_order_id        UUID REFERENCES sales_orders(id),
  start_date            DATE,
  end_date              DATE,
  status                TEXT DEFAULT 'active' CHECK (status IN ('active','expired','voided')),
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_warranty_records_updated_at BEFORE UPDATE ON warranty_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 25. SERVICE_REQUESTS (yêu cầu sửa chữa / bảo dưỡng)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE service_requests (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number           TEXT UNIQUE NOT NULL,
  customer_id             UUID REFERENCES customers(id),
  inventory_vehicle_id    UUID REFERENCES inventory_vehicles(id),
  warranty_record_id      UUID REFERENCES warranty_records(id),
  technician_id           UUID REFERENCES users(id),
  service_type            TEXT CHECK (service_type IN ('warranty','paid_repair','maintenance','inspection')),
  status                  TEXT DEFAULT 'received'
                            CHECK (status IN ('received','diagnosing','waiting_parts','repairing','done','delivered','cancelled')),
  symptom                 TEXT,
  diagnosis               TEXT,
  work_done               TEXT,
  odometer_km             INTEGER,
  battery_health_percent  NUMERIC(5,2),
  received_date           TIMESTAMPTZ DEFAULT NOW(),
  completed_date          TIMESTAMPTZ,
  labor_cost              NUMERIC(12,2) DEFAULT 0,
  parts_cost              NUMERIC(12,2) DEFAULT 0,
  total_cost              NUMERIC(12,2) DEFAULT 0,
  is_warranty_claim       BOOLEAN DEFAULT false,
  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_service_requests_updated_at BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 26. SERVICE_PARTS_USED (phụ tùng dùng trong sửa chữa)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE service_parts_used (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_request_id  UUID REFERENCES service_requests(id) ON DELETE CASCADE,
  spare_part_id       UUID REFERENCES spare_parts(id),
  quantity            INTEGER NOT NULL,
  unit_price          NUMERIC(12,2),
  is_warranty_covered BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- 27. SERVICE_TICKETS (phiếu dịch vụ DMS + QR SEPay)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE service_tickets (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_code             TEXT UNIQUE NOT NULL,
  dms_code                TEXT UNIQUE NOT NULL,
  customer_id             UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name           TEXT,
  customer_phone          TEXT,
  amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (payment_status IN ('pending','paid','cancelled')),
  payment_method          TEXT CHECK (payment_method IN ('qr_sepay','cash')) DEFAULT 'qr_sepay',
  sepay_transaction_id    TEXT,
  finance_transaction_id  UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,
  paid_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                   TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_service_tickets_dms ON service_tickets(dms_code);
CREATE INDEX idx_service_tickets_status ON service_tickets(payment_status);
CREATE INDEX idx_service_tickets_created_at ON service_tickets(created_at DESC);
CREATE INDEX idx_service_tickets_sepay ON service_tickets(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;
CREATE INDEX idx_service_tickets_customer ON service_tickets(customer_id)
  WHERE customer_id IS NOT NULL;
CREATE TRIGGER trg_service_tickets_updated_at BEFORE UPDATE ON service_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 28. PAYMENT_SETTINGS (cấu hình thanh toán)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE payment_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT UNIQUE NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_payment_settings_updated_at BEFORE UPDATE ON payment_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 29. INSTALLMENT_PROVIDERS (đơn vị tài chính trả góp)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE installment_providers (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      TEXT NOT NULL,
  interest_rate_per_month   NUMERIC(5,3) NOT NULL DEFAULT 0,
  available_months          INTEGER[] NOT NULL DEFAULT ARRAY[6,12,18,24,36],
  default_months            INTEGER NOT NULL DEFAULT 12,
  min_down_payment_percent  NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  note                      TEXT,
  sort_order                INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_installment_providers_updated_at BEFORE UPDATE ON installment_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
