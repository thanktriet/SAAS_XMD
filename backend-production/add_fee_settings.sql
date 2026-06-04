-- MIGRATION: add_fee_settings
-- Bảng cấu hình phí & dịch vụ đăng ký xe
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Bảng phí cố định (trước bạ, biển số, ...) ──────────────
CREATE TABLE IF NOT EXISTS fee_settings (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT          UNIQUE NOT NULL,  -- định danh nội bộ
  label       TEXT          NOT NULL,         -- tên hiển thị
  amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  note        TEXT,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 2. Bảng dịch vụ đăng ký xe ────────────────────────────────
CREATE TABLE IF NOT EXISTS registration_services (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT          NOT NULL,
  description TEXT,
  price       NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 3. Trigger updated_at ──────────────────────────────────────
CREATE TRIGGER trg_fee_settings_updated_at
  BEFORE UPDATE ON fee_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_registration_services_updated_at
  BEFORE UPDATE ON registration_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 4. Dữ liệu mặc định ────────────────────────────────────────
INSERT INTO fee_settings (key, label, amount, sort_order) VALUES
  ('phi_truoc_ba',    'Phí trước bạ',         500000, 1),
  ('phi_bien_so',     'Phí biển số xe',        150000, 2),
  ('phi_kiem_dinh',   'Phí kiểm định',          0,     3),
  ('phi_duong_bo',    'Phí đường bộ (năm)',    180000, 4),
  ('phi_bao_hiem_bb', 'Bảo hiểm bắt buộc',    66000,  5)
ON CONFLICT (key) DO NOTHING;

INSERT INTO registration_services (name, description, price, sort_order) VALUES
  ('Đăng ký biển số nhanh',    'Hỗ trợ đăng ký biển số tại cơ quan có thẩm quyền', 200000, 1),
  ('Làm đăng kiểm lần đầu',   'Kiểm tra kỹ thuật và đăng kiểm xe mới',             150000, 2),
  ('Giao xe tận nhà (nội ô)',  'Giao xe trong bán kính 10km',                        50000, 3),
  ('Giao xe tận nhà (ngoại ô)','Giao xe từ 10–30km',                                100000, 4)
ON CONFLICT DO NOTHING;
