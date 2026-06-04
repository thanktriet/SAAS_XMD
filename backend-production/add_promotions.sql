-- MIGRATION: add_promotions
-- Module Khuyến Mãi & Quà Tặng cho ERP Xe Máy Điện
-- Chạy trong Supabase SQL Editor — idempotent (chạy lại không lỗi)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. BẢNG CHÍNH: promotions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code      TEXT          UNIQUE NOT NULL,         -- KM202601001
  name            TEXT          NOT NULL,
  description     TEXT,

  -- Loại khuyến mãi
  promo_type      TEXT          NOT NULL DEFAULT 'percent'
                  CHECK (promo_type IN ('percent','fixed','gift','combo')),
  -- percent: giảm %  |  fixed: giảm tiền cố định
  -- gift: tặng kèm sản phẩm  |  combo: mua kèm giá ưu đãi

  discount_percent  NUMERIC(5,2)  DEFAULT 0,    -- dùng khi type=percent
  discount_amount   NUMERIC(15,2) DEFAULT 0,    -- dùng khi type=fixed

  -- Điều kiện áp dụng
  min_order_amount  NUMERIC(15,2) DEFAULT 0,    -- đơn tối thiểu mới được KM
  max_discount_cap  NUMERIC(15,2),              -- trần giảm tối đa (null = không giới hạn)

  -- Hiệu lực
  valid_from      DATE          NOT NULL,
  valid_until     DATE          NOT NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT true,

  -- Giới hạn sử dụng
  usage_limit     INTEGER,                      -- null = không giới hạn
  usage_count     INTEGER       NOT NULL DEFAULT 0,

  -- Phạm vi áp dụng (null = áp dụng tất cả)
  applicable_models  TEXT[],                   -- mảng vehicle_model id
  applicable_brands  TEXT[],                   -- mảng tên hãng xe

  -- Quà tặng kèm (dùng khi type=gift hoặc combo)
  gift_item_id    UUID          REFERENCES gift_items(id) ON DELETE SET NULL,
  gift_quantity   INTEGER       DEFAULT 1,

  note            TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 2. BẢNG: promo_usage — lịch sử áp dụng KM vào đơn hàng ─────────────────
CREATE TABLE IF NOT EXISTS promo_usage (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_id        UUID          NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  order_id        UUID          NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  customer_id     UUID          REFERENCES customers(id) ON DELETE SET NULL,

  discount_applied  NUMERIC(15,2) NOT NULL DEFAULT 0,  -- số tiền giảm thực tế
  note              TEXT,

  applied_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(promo_id, order_id)  -- mỗi KM chỉ áp dụng 1 lần / đơn
);

-- ─── 3. TRIGGER: auto mã KM ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_promo_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_promo_code'
  ) THEN
    CREATE TRIGGER trg_promo_code
      BEFORE INSERT ON promotions
      FOR EACH ROW EXECUTE FUNCTION generate_promo_code();
  END IF;
END $$;

-- ─── 4. TRIGGER: updated_at ──────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_promotions_updated_at'
  ) THEN
    CREATE TRIGGER trg_promotions_updated_at
      BEFORE UPDATE ON promotions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─── 5. TRIGGER: tăng usage_count khi áp dụng KM ─────────────────────────────
CREATE OR REPLACE FUNCTION increment_promo_usage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE promotions SET usage_count = usage_count + 1 WHERE id = NEW.promo_id;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_promo_usage_count'
  ) THEN
    CREATE TRIGGER trg_promo_usage_count
      AFTER INSERT ON promo_usage
      FOR EACH ROW EXECUTE FUNCTION increment_promo_usage();
  END IF;
END $$;

-- ─── 6. TRIGGER: giảm usage_count khi xoá bản ghi promo_usage ───────────────
CREATE OR REPLACE FUNCTION decrement_promo_usage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE promotions SET usage_count = GREATEST(0, usage_count - 1) WHERE id = OLD.promo_id;
  RETURN OLD;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_promo_usage_count_dec'
  ) THEN
    CREATE TRIGGER trg_promo_usage_count_dec
      AFTER DELETE ON promo_usage
      FOR EACH ROW EXECUTE FUNCTION decrement_promo_usage();
  END IF;
END $$;

-- ─── 7. INDEX ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_promotions_active
  ON promotions(is_active, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_promotions_type
  ON promotions(promo_type);

CREATE INDEX IF NOT EXISTS idx_promo_usage_order
  ON promo_usage(order_id);

CREATE INDEX IF NOT EXISTS idx_promo_usage_promo
  ON promo_usage(promo_id);

-- ─── 8. VIEW: promotions đang hoạt động (dùng trong POS) ─────────────────────
CREATE OR REPLACE VIEW v_active_promotions AS
SELECT
  p.*,
  gi.name   AS gift_item_name,
  gi.code   AS gift_item_code,
  gi.category AS gift_item_category
FROM promotions p
LEFT JOIN gift_items gi ON gi.id = p.gift_item_id
WHERE p.is_active = true
  AND CURRENT_DATE BETWEEN p.valid_from AND p.valid_until
  AND (p.usage_limit IS NULL OR p.usage_count < p.usage_limit);
