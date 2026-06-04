-- MIGRATION: add_order_extras
-- Thêm bảng khuyến mãi áp dụng, phí và dịch vụ cho từng đơn hàng
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Khuyến mãi áp dụng vào đơn ────────────────────────────
CREATE TABLE IF NOT EXISTS sales_order_promotions (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id         UUID          NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  promotion_id     UUID          REFERENCES promotions(id) ON DELETE SET NULL,
  promo_name       TEXT          NOT NULL,
  promo_type       TEXT          NOT NULL,  -- percent | fixed | gift | combo
  discount_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  gift_item_id     UUID          REFERENCES gift_items(id) ON DELETE SET NULL,
  gift_item_name   TEXT,
  gift_quantity    INTEGER       NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 2. Phí áp dụng vào đơn ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_order_fees (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID          NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  fee_key      TEXT          NOT NULL,
  fee_label    TEXT          NOT NULL,
  amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 3. Dịch vụ đăng ký áp dụng vào đơn ───────────────────────
CREATE TABLE IF NOT EXISTS sales_order_services (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID          NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  service_id   UUID          REFERENCES registration_services(id) ON DELETE SET NULL,
  service_name TEXT          NOT NULL,
  price        NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
