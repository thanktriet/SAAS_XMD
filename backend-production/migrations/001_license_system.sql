-- ============================================================
-- MIGRATION 001: HỆ THỐNG LICENSE CHI NHÁNH + BẢO MẬT NÂNG CẤP
-- Chạy trên PostgreSQL 14+
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. BẢNG BRANCHES (chi nhánh + thông tin license)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS branches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(50) UNIQUE NOT NULL,        -- mã chi nhánh: CN01, CN02...
  name            TEXT NOT NULL,                       -- tên chi nhánh
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  -- License info
  is_active       BOOLEAN DEFAULT true,               -- admin bật/tắt thủ công
  license_start   TIMESTAMPTZ,                        -- ngày bắt đầu license
  license_end     TIMESTAMPTZ,                        -- ngày hết hạn
  license_plan    TEXT DEFAULT 'basic'
                    CHECK (license_plan IN ('basic', 'pro', 'enterprise')),
  max_users       INTEGER DEFAULT 10,                 -- giới hạn user theo gói
  -- Metadata
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index cho query license check
CREATE INDEX idx_branches_active ON branches(is_active) WHERE is_active = true;
CREATE INDEX idx_branches_license_end ON branches(license_end);

-- ════════════════════════════════════════════════════════════════
-- 2. BRANCH LICENSE LOGS (audit trail)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS branch_license_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  action          TEXT NOT NULL
                    CHECK (action IN ('activate', 'extend', 'suspend', 'revoke', 'plan_change')),
  previous_end    TIMESTAMPTZ,
  new_end         TIMESTAMPTZ,
  previous_plan   TEXT,
  new_plan        TEXT,
  performed_by    UUID NOT NULL REFERENCES users(id),
  reason          TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_license_logs_branch ON branch_license_logs(branch_id);
CREATE INDEX idx_license_logs_date ON branch_license_logs(created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 3. REFRESH TOKENS (lưu DB để có thể revoke)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES branches(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,                      -- SHA256 hash của refresh token
  device_info     TEXT,                               -- user-agent hoặc device name
  ip_address      INET,
  is_revoked      BOOLEAN DEFAULT false,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id) WHERE is_revoked = false;
CREATE INDEX idx_refresh_tokens_branch ON refresh_tokens(branch_id) WHERE is_revoked = false;
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE is_revoked = false;
-- Cleanup: tự xóa token hết hạn
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ════════════════════════════════════════════════════════════════
-- 4. LOGIN ATTEMPTS (rate limiting + audit)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS login_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL,
  ip_address      INET,
  success         BOOLEAN DEFAULT false,
  failure_reason  TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at DESC);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address, created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 5. CẬP NHẬT BẢNG USERS — thêm FK branch_id → branches
-- ════════════════════════════════════════════════════════════════
-- Thêm column branch_id nếu chưa có (hoặc thêm FK constraint)
DO $$
BEGIN
  -- Nếu branch_id đã có nhưng chưa có FK
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'branch_id'
  ) THEN
    -- Thêm FK nếu chưa tồn tại
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_users_branch' AND table_name = 'users'
    ) THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
    END IF;
  ELSE
    ALTER TABLE users ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 6. FUNCTION: tự động khóa chi nhánh hết hạn (chạy bằng cron job)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_expire_branches()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE branches
  SET is_active = false, updated_at = NOW()
  WHERE is_active = true
    AND license_end IS NOT NULL
    AND license_end < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Revoke tất cả refresh token của chi nhánh bị khóa
  UPDATE refresh_tokens
  SET is_revoked = true
  WHERE branch_id IN (
    SELECT id FROM branches WHERE is_active = false AND license_end < NOW()
  )
  AND is_revoked = false;

  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════
-- 7. SEED: tạo chi nhánh mặc định từ dữ liệu có sẵn
-- ════════════════════════════════════════════════════════════════
-- (Chạy thủ công nếu cần migrate dữ liệu cũ)
-- INSERT INTO branches (code, name, is_active, license_start, license_end)
-- VALUES ('CN01', 'Chi nhánh chính', true, NOW(), NOW() + INTERVAL '1 year');
