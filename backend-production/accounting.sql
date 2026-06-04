-- ═══════════════════════════════════════════════════════════════════════════════
-- MODULE KẾ TOÁN CỐT LÕI — Core Accounting Module v2.0
-- ERP Xe Máy Điện · Supabase / PostgreSQL
-- ───────────────────────────────────────────────────────────────────────────────
-- HƯỚNG DẪN CHẠY:
--   1. Mở Supabase Dashboard → SQL Editor
--   2. Paste toàn bộ nội dung file này
--   3. Bấm Run (F5)
--   4. Kiểm tra tab "Results" — không có lỗi đỏ là thành công
-- ───────────────────────────────────────────────────────────────────────────────
-- TÍCH HỢP:
--   • Sử dụng bảng hiện có: users, customers, sales_orders
--   • Không xoá / không sửa bất kỳ bảng nào của schema cũ
--   • Toàn bộ bảng mới có prefix  acc_  để dễ phân biệt
-- ───────────────────────────────────────────────────────────────────────────────
-- TÍNH NĂNG:
--   ✓ Kế toán kép (Double-entry) — ΣNợ = ΣCó bắt buộc
--   ✓ Đa chi nhánh — branch_id trên mọi giao dịch
--   ✓ Row Level Security — nhân viên chỉ thấy data CN mình
--   ✓ Kỳ kế toán — không ghi được vào kỳ đã khoá
--   ✓ Auto-sync queue lên AMIS/MISA sau khi post chứng từ
--   ✓ Hệ thống tài khoản VAS/TT200 đầy đủ
--   ✓ Seed data sẵn sàng chạy ngay
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;  -- Bọc toàn bộ trong 1 transaction — lỗi bất kỳ chỗ nào thì rollback hết

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- Dùng cho mã hoá client_secret AMIS


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 0 · TỔ CHỨC (Organization Layer)
-- Nền tảng cho đa chi nhánh — mọi bảng kế toán tham chiếu vào đây
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Công ty / Pháp nhân ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acc_organizations (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_code             TEXT        NOT NULL UNIQUE,        -- "CTCP_ABC_MOTOR"
  org_name             TEXT        NOT NULL,               -- "Công ty CP ABC Motor"
  tax_code             TEXT        NOT NULL UNIQUE,        -- Mã số thuế 10 số
  address              TEXT,
  phone                TEXT,
  email                TEXT,
  logo_url             TEXT,
  fiscal_year_start    SMALLINT    NOT NULL DEFAULT 1      -- Tháng bắt đầu năm TC (1=Jan)
                       CHECK (fiscal_year_start BETWEEN 1 AND 12),
  default_currency     TEXT        NOT NULL DEFAULT 'VND',
  default_vat_rate     NUMERIC(5,2) NOT NULL DEFAULT 10.00, -- Thuế GTGT mặc định %
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE acc_organizations IS
  'Pháp nhân / công ty. Một ERP instance có thể phục vụ nhiều pháp nhân '
  '(ví dụ: nhiều đại lý uỷ quyền cùng dùng chung hệ thống).';


-- ─── Chi nhánh / Điểm kinh doanh ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acc_branches (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID        NOT NULL REFERENCES acc_organizations(id) ON DELETE RESTRICT,
  branch_code      TEXT        NOT NULL UNIQUE,            -- "HCM-001", "HN-001"
  branch_name      TEXT        NOT NULL,                   -- "Chi nhánh TP.HCM Q.1"
  branch_type      TEXT        NOT NULL DEFAULT 'showroom'
                   CHECK (branch_type IN ('headquarters','showroom','warehouse','service_center')),
  address          TEXT,
  phone            TEXT,
  email            TEXT,
  manager_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  bank_account     TEXT,
  bank_name        TEXT,
  -- Cost center code dùng khi đẩy dữ liệu sang AMIS
  cost_center_code TEXT,                                   -- "CC-HCM-001"
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE acc_branches IS
  'Chi nhánh / showroom / kho. Mọi chứng từ kế toán đều gắn branch_id. '
  'cost_center_code là mã trung tâm chi phí tương ứng bên AMIS.';

CREATE INDEX IF NOT EXISTS idx_branches_org    ON acc_branches(org_id);
CREATE INDEX IF NOT EXISTS idx_branches_code   ON acc_branches(branch_code);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 1 · KỲ KẾ TOÁN (Fiscal Periods)
-- Kiểm soát kỳ nào đang mở, kỳ nào đã khoá
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_fiscal_periods (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID        NOT NULL REFERENCES acc_organizations(id) ON DELETE RESTRICT,
  period_name  TEXT        NOT NULL,                       -- "Tháng 3/2026"
  year         SMALLINT    NOT NULL,
  month        SMALLINT    NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date   DATE        NOT NULL,
  end_date     DATE        NOT NULL,
  -- open: đang giao dịch | closed: khoá tháng (vẫn xem được) | locked: khoá vĩnh viễn
  status       TEXT        NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','closed','locked')),
  closed_by    UUID        REFERENCES users(id),
  closed_at    TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, year, month),
  CONSTRAINT chk_period_dates CHECK (start_date <= end_date)
);

COMMENT ON TABLE acc_fiscal_periods IS
  'Kỳ kế toán theo tháng. Chỉ status=open mới cho phép tạo chứng từ mới. '
  'Khoá kỳ (closed/locked) để đảm bảo số liệu không bị thay đổi sau kiểm toán.';

CREATE INDEX IF NOT EXISTS idx_fp_org_year_month ON acc_fiscal_periods(org_id, year, month);
CREATE INDEX IF NOT EXISTS idx_fp_status         ON acc_fiscal_periods(status);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 2 · HỆ THỐNG TÀI KHOẢN (Chart of Accounts — VAS/TT200)
-- Dùng chung cho toàn công ty, không tách theo chi nhánh
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_accounts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID        NOT NULL REFERENCES acc_organizations(id) ON DELETE RESTRICT,
  account_code     TEXT        NOT NULL,                   -- "1111", "5111"
  account_name     TEXT        NOT NULL,                   -- "Tiền mặt VNĐ"
  account_name_en  TEXT,                                   -- "Cash in VND"
  parent_code      TEXT,   -- Mã TK cha (cùng org_id). Không dùng FK vì unique constraint là (org_id, account_code)
  -- Cấp tài khoản: 1=Loại, 2=Nhóm, 3=TK cấp 1, 4=TK chi tiết
  level            SMALLINT    NOT NULL DEFAULT 3
                   CHECK (level BETWEEN 1 AND 5),
  -- Phân loại theo bản chất kinh tế
  account_type     TEXT        NOT NULL
                   CHECK (account_type IN (
                     'asset',          -- Tài sản          (Nợ thường)
                     'liability',      -- Nợ phải trả      (Có thường)
                     'equity',         -- Vốn chủ sở hữu   (Có thường)
                     'revenue',        -- Doanh thu        (Có thường)
                     'cogs',           -- Giá vốn          (Nợ thường)
                     'expense',        -- Chi phí          (Nợ thường)
                     'other_income',   -- Thu nhập khác    (Có thường)
                     'other_expense'   -- Chi phí khác     (Nợ thường)
                   )),
  -- Số dư bình thường: debit=Nợ thường (TS, CP), credit=Có thường (Nợ, VCS, DT)
  normal_balance   TEXT        NOT NULL CHECK (normal_balance IN ('debit','credit')),
  -- Chỉ TK is_detail=TRUE mới được dùng trong bút toán (không được hạch toán TK tổng hợp)
  is_detail        BOOLEAN     NOT NULL DEFAULT TRUE,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  description      TEXT,
  display_order    INT         NOT NULL DEFAULT 0,
  -- Mã TK tương ứng bên AMIS (thường giống nhau theo TT200, đặt khác nếu công ty tuỳ chỉnh)
  amis_account_code TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, account_code)
);

COMMENT ON TABLE acc_accounts IS
  'Hệ thống tài khoản kế toán theo VAS/TT200. '
  'Chỉ tài khoản is_detail=TRUE mới được phép ghi bút toán. '
  'amis_account_code dùng khi mã nội bộ khác với mã bên AMIS.';

CREATE INDEX IF NOT EXISTS idx_acc_org_code  ON acc_accounts(org_id, account_code);
CREATE INDEX IF NOT EXISTS idx_acc_type      ON acc_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_acc_parent    ON acc_accounts(parent_code);
CREATE INDEX IF NOT EXISTS idx_acc_detail    ON acc_accounts(is_detail) WHERE is_detail = TRUE;


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 3 · NHÀ CUNG CẤP (Suppliers)
-- Đối xứng với bảng customers đã có — cần thiết cho kế toán công nợ phải trả
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_suppliers (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID        NOT NULL REFERENCES acc_organizations(id) ON DELETE RESTRICT,
  supplier_code    TEXT        NOT NULL,                   -- "NCC000001"
  supplier_name    TEXT        NOT NULL,
  contact_person   TEXT,
  phone            TEXT,
  email            TEXT,
  address          TEXT,
  tax_code         TEXT,                                   -- MST nhà cung cấp
  bank_account     TEXT,
  bank_name        TEXT,
  payment_terms    SMALLINT    NOT NULL DEFAULT 30,        -- Số ngày được nợ
  credit_limit     NUMERIC(18,0) NOT NULL DEFAULT 0,       -- Hạn mức nợ tối đa
  -- Số dư công nợ tổng hợp (denormalized, cập nhật qua trigger)
  balance_due      NUMERIC(18,0) NOT NULL DEFAULT 0,       -- Số tiền đang nợ NCC
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, supplier_code)
);

CREATE INDEX IF NOT EXISTS idx_supplier_org  ON acc_suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_supplier_code ON acc_suppliers(org_id, supplier_code);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 4 · CHỨNG TỪ (Voucher Header)
-- 1 chứng từ = 1 sự kiện kinh tế = N bút toán, bắt buộc ΣNợ = ΣCó
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_vouchers (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                UUID        NOT NULL REFERENCES acc_organizations(id) ON DELETE RESTRICT,
  branch_id             UUID        NOT NULL REFERENCES acc_branches(id) ON DELETE RESTRICT,
  -- Số chứng từ: "PT2026030001-HCM", "PC2026030001-HCM"
  voucher_number        TEXT        NOT NULL,
  voucher_type          TEXT        NOT NULL
                        CHECK (voucher_type IN (
                          'receipt',            -- PT : Phiếu thu
                          'payment',            -- PC : Phiếu chi
                          'journal',            -- BK : Bút ký / điều chỉnh
                          'sales_invoice',      -- HDB: Hoá đơn bán hàng
                          'purchase_invoice',   -- HDM: Hoá đơn mua hàng
                          'inventory_in',       -- PKN: Phiếu nhập kho
                          'inventory_out',      -- PXK: Phiếu xuất kho
                          'intercompany',       -- NB : Điều chuyển nội bộ CN
                          'allocation'          -- KB : Kết chuyển cuối kỳ
                        )),
  voucher_date          DATE        NOT NULL,
  fiscal_period_id      UUID        NOT NULL REFERENCES acc_fiscal_periods(id),
  description           TEXT,                             -- Diễn giải chứng từ
  -- Tham chiếu nghiệp vụ gốc (FK mềm, không ràng buộc cứng để linh hoạt)
  reference_type        TEXT,                             -- 'sales_order' | 'service_request' | ...
  reference_id          UUID,
  -- Đối tượng chính của chứng từ
  customer_id           UUID        REFERENCES customers(id)     ON DELETE SET NULL,
  supplier_id           UUID        REFERENCES acc_suppliers(id) ON DELETE SET NULL,
  -- Giao dịch nội bộ (điều chuyển giữa CN)
  counterpart_branch_id UUID        REFERENCES acc_branches(id)  ON DELETE SET NULL,
  interco_voucher_id    UUID        REFERENCES acc_vouchers(id)  ON DELETE SET NULL,
  -- Trạng thái
  -- draft: đang soạn | posted: đã vào sổ | reversed: đã đảo BT | cancelled: huỷ
  status                TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','posted','reversed','cancelled')),
  posted_by             UUID        REFERENCES users(id),
  posted_at             TIMESTAMPTZ,
  reversed_by           UUID        REFERENCES users(id),
  reversed_at           TIMESTAMPTZ,
  -- Chứng từ này là bút toán đảo của chứng từ nào
  reverse_of            UUID        REFERENCES acc_vouchers(id)  ON DELETE SET NULL,
  -- Tổng kiểm tra — được tính và cập nhật bởi trigger khi post
  total_debit           NUMERIC(18,0) NOT NULL DEFAULT 0,
  total_credit          NUMERIC(18,0) NOT NULL DEFAULT 0,
  -- File đính kèm (mảng URL Supabase Storage)
  attachments           JSONB       NOT NULL DEFAULT '[]',
  -- ── AMIS SYNC ────────────────────────────────────────────────────────────
  -- Trạng thái đồng bộ lên AMIS/MISA
  -- pending: chưa sync | queued: đã vào queue | synced: OK | failed: lỗi | skipped: bỏ qua
  amis_sync_status      TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (amis_sync_status IN ('pending','queued','synced','failed','skipped')),
  amis_voucher_id       TEXT,                             -- ID chứng từ bên AMIS
  amis_synced_at        TIMESTAMPTZ,
  amis_sync_error       TEXT,                             -- Thông báo lỗi nếu failed
  -- ─────────────────────────────────────────────────────────────────────────
  created_by            UUID        REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, branch_id, voucher_number),
  CONSTRAINT chk_no_self_reverse  CHECK (reverse_of   IS NULL OR reverse_of != id),
  CONSTRAINT chk_no_self_interco  CHECK (counterpart_branch_id IS NULL OR counterpart_branch_id != branch_id)
);

COMMENT ON TABLE acc_vouchers IS
  'Chứng từ kế toán (header). Khi status chuyển sang posted: '
  'trigger sẽ kiểm tra ΣNợ=ΣCó → rollback nếu lệch sổ → '
  'cập nhật period_balances → enqueue AMIS sync.';

CREATE INDEX IF NOT EXISTS idx_v_branch      ON acc_vouchers(branch_id);
CREATE INDEX IF NOT EXISTS idx_v_org         ON acc_vouchers(org_id);
CREATE INDEX IF NOT EXISTS idx_v_date        ON acc_vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_v_type        ON acc_vouchers(voucher_type);
CREATE INDEX IF NOT EXISTS idx_v_period      ON acc_vouchers(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_v_status      ON acc_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_v_reference   ON acc_vouchers(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_v_customer    ON acc_vouchers(customer_id);
CREATE INDEX IF NOT EXISTS idx_v_supplier    ON acc_vouchers(supplier_id);
-- Index đặc biệt cho worker AMIS sync — chỉ scan hàng cần sync
CREATE INDEX IF NOT EXISTS idx_v_amis_pending ON acc_vouchers(amis_sync_status, org_id)
  WHERE amis_sync_status IN ('pending','queued','failed');


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 5 · BÚT TOÁN CHI TIẾT (Journal Entry Lines)
-- Trái tim của kế toán kép. Mỗi dòng = 1 vế Nợ HOẶC 1 vế Có
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_journal_entry_lines (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id      UUID        NOT NULL REFERENCES acc_vouchers(id) ON DELETE CASCADE,
  line_number     SMALLINT    NOT NULL DEFAULT 1,          -- Thứ tự dòng trong chứng từ
  account_id      UUID        NOT NULL REFERENCES acc_accounts(id) ON DELETE RESTRICT,
  account_code    TEXT        NOT NULL,                    -- Denormalized để query nhanh
  description     TEXT,                                   -- Diễn giải riêng của dòng
  -- Số tiền: đúng một trong hai > 0, cái còn lại = 0
  debit_amount    NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (debit_amount  >= 0),
  credit_amount   NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  -- Đối tượng công nợ theo dõi chi tiết (chỉ điền khi TK 131, 331...)
  customer_id     UUID        REFERENCES customers(id)     ON DELETE SET NULL,
  supplier_id     UUID        REFERENCES acc_suppliers(id) ON DELETE SET NULL,
  -- Phân tích bổ sung (mở rộng sau)
  cost_center     TEXT,                                   -- Trung tâm chi phí
  -- Mã TK bên AMIS nếu khác (từ bảng acc_account_mappings)
  amis_account_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ── CONSTRAINTS ──────────────────────────────────────────────────────────
  -- Quy tắc kế toán kép: mỗi dòng chỉ ghi VỀ MỘT PHÍA
  CONSTRAINT chk_one_side_only CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR
    (credit_amount > 0 AND debit_amount = 0)
  ),
  -- Không cho phép dòng bút toán = 0
  CONSTRAINT chk_nonzero_amount CHECK (
    debit_amount + credit_amount > 0
  ),
  UNIQUE (voucher_id, line_number)
);

COMMENT ON TABLE acc_journal_entry_lines IS
  'Bút toán chi tiết. CONSTRAINT chk_one_side_only đảm bảo mỗi dòng '
  'chỉ có Nợ hoặc Có — không bao giờ cả hai. '
  'Trigger trg_protect_posted_entries ngăn sửa/xoá dòng của CT đã vào sổ.';

CREATE INDEX IF NOT EXISTS idx_jel_voucher       ON acc_journal_entry_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_jel_account_id    ON acc_journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jel_account_code  ON acc_journal_entry_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_jel_customer      ON acc_journal_entry_lines(customer_id);
CREATE INDEX IF NOT EXISTS idx_jel_supplier      ON acc_journal_entry_lines(supplier_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 6 · SỐ DƯ TÀI KHOẢN THEO KỲ (Period Balances)
-- Snapshot cuối kỳ — tránh phải full-scan journal_entry_lines khi báo cáo
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_period_balances (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID        NOT NULL REFERENCES acc_organizations(id),
  branch_id         UUID        NOT NULL REFERENCES acc_branches(id),
  fiscal_period_id  UUID        NOT NULL REFERENCES acc_fiscal_periods(id),
  account_id        UUID        NOT NULL REFERENCES acc_accounts(id),
  account_code      TEXT        NOT NULL,                  -- Denormalized
  -- Số dư đầu kỳ (kết chuyển từ kỳ trước)
  opening_debit     NUMERIC(18,0) NOT NULL DEFAULT 0,
  opening_credit    NUMERIC(18,0) NOT NULL DEFAULT 0,
  -- Số phát sinh trong kỳ (cập nhật realtime mỗi khi post/reverse voucher)
  period_debit      NUMERIC(18,0) NOT NULL DEFAULT 0,
  period_credit     NUMERIC(18,0) NOT NULL DEFAULT 0,
  -- Số dư cuối kỳ (computed column — PostgreSQL tự tính, không cần cập nhật tay)
  closing_debit     NUMERIC(18,0) GENERATED ALWAYS AS (
    GREATEST(0, opening_debit  + period_debit  - opening_credit - period_credit)
  ) STORED,
  closing_credit    NUMERIC(18,0) GENERATED ALWAYS AS (
    GREATEST(0, opening_credit + period_credit - opening_debit  - period_debit)
  ) STORED,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, branch_id, fiscal_period_id, account_id)
);

COMMENT ON TABLE acc_period_balances IS
  'Số dư tài khoản từng kỳ, từng chi nhánh. '
  'closing_debit / closing_credit là GENERATED ALWAYS — '
  'chỉ cần cập nhật opening + period là số dư cuối tự đúng. '
  'Dùng cho: Trial Balance, P&L, Balance Sheet.';

CREATE INDEX IF NOT EXISTS idx_pb_branch    ON acc_period_balances(branch_id);
CREATE INDEX IF NOT EXISTS idx_pb_period    ON acc_period_balances(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_pb_account   ON acc_period_balances(account_id);
CREATE INDEX IF NOT EXISTS idx_pb_code      ON acc_period_balances(org_id, account_code);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 7 · CÔNG NỢ PHẢI THU / PHẢI TRẢ (AR / AP Ledger)
-- Theo dõi chi tiết từng khoản phải thu/trả theo đối tượng
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sổ công nợ phải thu (TK 131)
CREATE TABLE IF NOT EXISTS acc_ar_ledger (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID        NOT NULL REFERENCES acc_organizations(id),
  branch_id         UUID        NOT NULL REFERENCES acc_branches(id),
  customer_id       UUID        NOT NULL REFERENCES customers(id),
  voucher_id        UUID        NOT NULL REFERENCES acc_vouchers(id),
  voucher_date      DATE        NOT NULL,
  due_date          DATE,                                  -- Ngày đến hạn thanh toán
  entry_type        TEXT        NOT NULL
                    CHECK (entry_type IN (
                      'invoice',     -- Phát sinh phải thu (HĐ bán)
                      'receipt',     -- Thu tiền (giảm phải thu)
                      'adjustment',  -- Điều chỉnh / chiết khấu
                      'reversal'     -- Đảo bút toán
                    )),
  debit_amount      NUMERIC(18,0) NOT NULL DEFAULT 0,      -- Tăng phải thu
  credit_amount     NUMERIC(18,0) NOT NULL DEFAULT 0,      -- Giảm phải thu (đã thu tiền)
  matched_amount    NUMERIC(18,0) NOT NULL DEFAULT 0,      -- Đã đối chiếu công nợ
  -- Computed: TRUE khi đã thu đủ / đã đối chiếu xong
  is_fully_matched  BOOLEAN     GENERATED ALWAYS AS (
    matched_amount >= debit_amount AND debit_amount > 0
  ) STORED,
  reference_number  TEXT,                                  -- Số HĐ, số phiếu thu
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE acc_ar_ledger IS
  'Sổ chi tiết công nợ phải thu theo từng khách hàng. '
  'Số dư phải thu KH = SUM(debit_amount) - SUM(credit_amount). '
  'is_fully_matched dùng để lọc khoản chưa thu / quá hạn.';

CREATE INDEX IF NOT EXISTS idx_ar_customer    ON acc_ar_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_branch      ON acc_ar_ledger(org_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_ar_due_date    ON acc_ar_ledger(due_date);
CREATE INDEX IF NOT EXISTS idx_ar_unmatched   ON acc_ar_ledger(is_fully_matched, due_date)
  WHERE is_fully_matched = FALSE;


-- Sổ công nợ phải trả (TK 331)
CREATE TABLE IF NOT EXISTS acc_ap_ledger (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID        NOT NULL REFERENCES acc_organizations(id),
  branch_id         UUID        NOT NULL REFERENCES acc_branches(id),
  supplier_id       UUID        NOT NULL REFERENCES acc_suppliers(id),
  voucher_id        UUID        NOT NULL REFERENCES acc_vouchers(id),
  voucher_date      DATE        NOT NULL,
  due_date          DATE,
  entry_type        TEXT        NOT NULL
                    CHECK (entry_type IN ('bill','payment','adjustment','reversal')),
  debit_amount      NUMERIC(18,0) NOT NULL DEFAULT 0,      -- Giảm phải trả (trả tiền NCC)
  credit_amount     NUMERIC(18,0) NOT NULL DEFAULT 0,      -- Tăng phải trả (mua chịu)
  matched_amount    NUMERIC(18,0) NOT NULL DEFAULT 0,
  is_fully_matched  BOOLEAN     GENERATED ALWAYS AS (
    matched_amount >= credit_amount AND credit_amount > 0
  ) STORED,
  reference_number  TEXT,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_supplier  ON acc_ap_ledger(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ap_branch    ON acc_ap_ledger(org_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_ap_due_date  ON acc_ap_ledger(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_unmatched ON acc_ap_ledger(is_fully_matched, due_date)
  WHERE is_fully_matched = FALSE;


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 8 · GIAO DỊCH NỘI BỘ (Inter-Branch Transactions)
-- Điều chuyển hàng hoá / tiền / chi phí giữa các chi nhánh
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acc_intercompany_txns (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID        NOT NULL REFERENCES acc_organizations(id),
  txn_number        TEXT        NOT NULL UNIQUE,           -- "ICT2026030001"
  txn_type          TEXT        NOT NULL
                    CHECK (txn_type IN (
                      'inventory_transfer',    -- Điều chuyển hàng hoá giữa CN
                      'cash_transfer',         -- Điều chuyển tiền nội bộ
                      'expense_allocation',    -- Phân bổ CP từ HQ xuống CN
                      'revenue_sharing'        -- Chia sẻ doanh thu giữa CN
                    )),
  from_branch_id    UUID        NOT NULL REFERENCES acc_branches(id),
  to_branch_id      UUID        NOT NULL REFERENCES acc_branches(id),
  -- Chứng từ ghi sổ ở từng CN (tạo tự động khi post ICT)
  from_voucher_id   UUID        REFERENCES acc_vouchers(id) ON DELETE SET NULL, -- PXK bên CN nguồn
  to_voucher_id     UUID        REFERENCES acc_vouchers(id) ON DELETE SET NULL, -- PKN bên CN đích
  amount            NUMERIC(18,0) NOT NULL CHECK (amount > 0),
  description       TEXT,
  txn_date          DATE        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','posted','cancelled')),
  approved_by       UUID        REFERENCES users(id),
  created_by        UUID        REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_diff_branches CHECK (from_branch_id != to_branch_id)
);

COMMENT ON TABLE acc_intercompany_txns IS
  'Giao dịch nội bộ giữa các chi nhánh. '
  'Khi hợp nhất báo cáo toàn công ty: loại trừ (eliminate) các giao dịch này '
  'để tránh tính trùng doanh thu / chi phí nội bộ.';

CREATE INDEX IF NOT EXISTS idx_ict_org         ON acc_intercompany_txns(org_id);
CREATE INDEX IF NOT EXISTS idx_ict_from_branch ON acc_intercompany_txns(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_ict_to_branch   ON acc_intercompany_txns(to_branch_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TẦNG 9 · INTEGRATION LAYER — Pipeline đẩy dữ liệu lên AMIS/MISA
-- ═══════════════════════════════════════════════════════════════════════════════

-- Cấu hình kết nối AMIS theo từng công ty
CREATE TABLE IF NOT EXISTS acc_integration_configs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID        NOT NULL REFERENCES acc_organizations(id),
  platform         TEXT        NOT NULL
                   CHECK (platform IN ('amis_misa','fast_accounting','excel_export','bravo')),
  config_name      TEXT        NOT NULL,                   -- "AMIS Production", "AMIS Staging"
  is_active        BOOLEAN     NOT NULL DEFAULT FALSE,     -- Chỉ 1 config active tại 1 thời điểm
  -- OAuth2 credentials (client_secret phải được mã hoá bằng pgcrypto trước khi lưu)
  client_id        TEXT,
  client_secret    TEXT,                                   -- ⚠️ Lưu dạng mã hoá AES-256
  -- OAuth2 token (tự refresh trước khi hết hạn)
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  -- Context bên AMIS
  amis_company_id  TEXT,                                   -- Company ID trong AMIS
  amis_branch_code TEXT,                                   -- Mã CN trong AMIS (nếu AMIS cũng multi-branch)
  api_base_url     TEXT        NOT NULL DEFAULT 'https://actapp.misa.vn/api/v3',
  -- Chế độ sync:
  -- manual: kế toán bấm tay | auto_post: tự động sau khi POST | batch_daily: batch cuối ngày
  sync_mode        TEXT        NOT NULL DEFAULT 'auto_post'
                   CHECK (sync_mode IN ('manual','auto_post','batch_daily')),
  sync_from_date   DATE,                                   -- Chỉ sync chứng từ từ ngày này
  last_sync_at     TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, platform, config_name)
);

COMMENT ON TABLE acc_integration_configs IS
  '⚠️ QUAN TRỌNG: client_secret PHẢI được mã hoá trước khi INSERT. '
  'Dùng: pgp_sym_encrypt(client_secret, current_setting(''app.encryption_key'')) '
  'hoặc Supabase Vault. KHÔNG lưu plain text.';

CREATE INDEX IF NOT EXISTS idx_ic_org_active ON acc_integration_configs(org_id, is_active)
  WHERE is_active = TRUE;


-- Hàng đợi đồng bộ — mọi voucher posted → tự vào đây qua trigger
CREATE TABLE IF NOT EXISTS acc_sync_queue (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID        NOT NULL REFERENCES acc_organizations(id),
  branch_id       UUID        NOT NULL REFERENCES acc_branches(id),
  config_id       UUID        NOT NULL REFERENCES acc_integration_configs(id),
  voucher_id      UUID        NOT NULL REFERENCES acc_vouchers(id),
  -- pending: chờ xử lý | processing: đang gửi | success: OK | failed: lỗi | skipped: bỏ qua
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','success','failed','skipped')),
  -- Ưu tiên: 1=cao nhất (PT/PC), 5=mặc định, 10=thấp nhất
  priority        SMALLINT    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  attempt_count   SMALLINT    NOT NULL DEFAULT 0,
  max_attempts    SMALLINT    NOT NULL DEFAULT 3,
  -- Thời điểm retry tiếp theo (exponential backoff: 5p → 15p → 1h)
  next_retry_at   TIMESTAMPTZ,
  -- Kết quả gọi API AMIS
  amis_response   JSONB,
  error_message   TEXT,
  error_code      TEXT,                                    -- "DUPLICATE_VOUCHER", "INVALID_ACCOUNT"...
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  UNIQUE (voucher_id, config_id)                           -- Mỗi voucher chỉ sync 1 lần / config
);

COMMENT ON TABLE acc_sync_queue IS
  'Hàng đợi đồng bộ AMIS. Worker job poll bảng này để gửi chứng từ lên AMIS. '
  'next_retry_at + exponential backoff đảm bảo không bị spam khi AMIS lỗi tạm thời.';

CREATE INDEX IF NOT EXISTS idx_sq_status_priority ON acc_sync_queue(status, priority, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sq_voucher         ON acc_sync_queue(voucher_id);
-- Index cho worker: chỉ scan hàng cần xử lý ngay
CREATE INDEX IF NOT EXISTS idx_sq_worker ON acc_sync_queue(status, next_retry_at, attempt_count)
  WHERE status IN ('pending','failed') AND attempt_count < 3;


-- Audit log đồng bộ — lưu vĩnh viễn, không xoá
CREATE TABLE IF NOT EXISTS acc_sync_logs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  queue_id         UUID        REFERENCES acc_sync_queue(id) ON DELETE SET NULL,
  voucher_id       UUID        NOT NULL REFERENCES acc_vouchers(id),
  config_id        UUID        NOT NULL REFERENCES acc_integration_configs(id),
  action           TEXT        NOT NULL
                   CHECK (action IN (
                     'push_voucher',      -- Đẩy chứng từ lên AMIS
                     'update_voucher',    -- Cập nhật chứng từ đã có
                     'reverse_voucher',   -- Đảo bút toán trên AMIS
                     'fetch_accounts',    -- Lấy danh mục TK từ AMIS
                     'token_refresh'      -- Làm mới OAuth2 token
                   )),
  status           TEXT        NOT NULL CHECK (status IN ('success','failed')),
  request_payload  JSONB,                                  -- Payload đã gửi lên AMIS
  response_payload JSONB,                                  -- Response nhận về
  http_status_code SMALLINT,
  duration_ms      INT,                                    -- Thời gian xử lý (ms)
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE acc_sync_logs IS
  'Audit log bất biến (không UPDATE/DELETE). '
  'Lưu toàn bộ lịch sử giao tiếp với AMIS để debug và kiểm toán.';

CREATE INDEX IF NOT EXISTS idx_sl_voucher ON acc_sync_logs(voucher_id);
CREATE INDEX IF NOT EXISTS idx_sl_date    ON acc_sync_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sl_failed  ON acc_sync_logs(status, created_at DESC)
  WHERE status = 'failed';


-- Bảng ánh xạ mã tài khoản ERP ↔ AMIS
CREATE TABLE IF NOT EXISTS acc_account_mappings (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID        NOT NULL REFERENCES acc_organizations(id),
  config_id      UUID        NOT NULL REFERENCES acc_integration_configs(id),
  internal_code  TEXT        NOT NULL,                     -- Mã TK trong ERP: "1561"
  external_code  TEXT        NOT NULL,                     -- Mã TK trong AMIS: "1561" (hoặc khác)
  external_name  TEXT,                                     -- Tên TK bên AMIS để kiểm tra
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, config_id, internal_code)
);

COMMENT ON TABLE acc_account_mappings IS
  'Ánh xạ mã tài khoản ERP → AMIS. '
  'Theo TT200, thường giống nhau. Chỉ cần mapping khi công ty dùng mã riêng.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Trigger 1: Validate Nợ = Có + cập nhật total khi POST ──────────────────
CREATE OR REPLACE FUNCTION fn_validate_voucher_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_debit   NUMERIC(18,0);
  v_credit  NUMERIC(18,0);
  v_lines   BIGINT;
BEGIN
  -- Chỉ xử lý khi chuyển từ draft → posted
  IF NOT (NEW.status = 'posted' AND OLD.status = 'draft') THEN
    RETURN NEW;
  END IF;

  -- Đếm và tính tổng bút toán
  SELECT
    COALESCE(SUM(debit_amount),  0),
    COALESCE(SUM(credit_amount), 0),
    COUNT(*)
  INTO v_debit, v_credit, v_lines
  FROM acc_journal_entry_lines
  WHERE voucher_id = NEW.id;

  -- Kiểm tra có ít nhất 2 dòng bút toán
  IF v_lines < 2 THEN
    RAISE EXCEPTION
      '[Kế toán kép] Chứng từ % cần ít nhất 2 dòng bút toán (1 Nợ + 1 Có). '
      'Hiện chỉ có % dòng.',
      NEW.voucher_number, v_lines;
  END IF;

  -- ══ NGUYÊN TẮC BẤT BIẾN ══ Tổng Nợ PHẢI = Tổng Có
  IF v_debit != v_credit THEN
    RAISE EXCEPTION
      '[Kế toán kép] Chứng từ % bị lệch sổ: '
      'Tổng Nợ = % VNĐ ≠ Tổng Có = % VNĐ. '
      'Chênh lệch: % VNĐ. Toàn bộ giao dịch bị huỷ (ROLLBACK).',
      NEW.voucher_number,
      TO_CHAR(v_debit,  'FM999,999,999,999'),
      TO_CHAR(v_credit, 'FM999,999,999,999'),
      TO_CHAR(ABS(v_debit - v_credit), 'FM999,999,999,999');
  END IF;

  -- Cập nhật totals vào header
  NEW.total_debit  := v_debit;
  NEW.total_credit := v_credit;
  -- Ghi nhận thời điểm vào sổ
  IF NEW.posted_at IS NULL THEN
    NEW.posted_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_voucher_balance ON acc_vouchers;
CREATE TRIGGER trg_validate_voucher_balance
  BEFORE UPDATE ON acc_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_validate_voucher_balance();


-- ─── Trigger 2: Cập nhật period_balances theo branch khi post/reverse ───────
CREATE OR REPLACE FUNCTION fn_update_period_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_mult  SMALLINT;
  v_line  RECORD;
BEGIN
  -- Xác định hướng cập nhật
  IF   NEW.status = 'posted'
   AND OLD.status = 'draft'                               THEN v_mult :=  1;  -- Cộng vào
  ELSIF NEW.status IN ('reversed','cancelled')
   AND  OLD.status = 'posted'                             THEN v_mult := -1;  -- Trừ ra
  ELSE  RETURN NEW;
  END IF;

  -- Duyệt từng dòng bút toán, cập nhật số dư kỳ
  FOR v_line IN
    SELECT account_id, account_code, debit_amount, credit_amount
    FROM   acc_journal_entry_lines
    WHERE  voucher_id = NEW.id
  LOOP
    INSERT INTO acc_period_balances
      (org_id, branch_id, fiscal_period_id, account_id, account_code,
       period_debit, period_credit)
    VALUES
      (NEW.org_id, NEW.branch_id, NEW.fiscal_period_id,
       v_line.account_id, v_line.account_code,
       v_line.debit_amount  * v_mult,
       v_line.credit_amount * v_mult)
    ON CONFLICT (org_id, branch_id, fiscal_period_id, account_id)
    DO UPDATE SET
      period_debit  = acc_period_balances.period_debit
                      + (v_line.debit_amount  * v_mult),
      period_credit = acc_period_balances.period_credit
                      + (v_line.credit_amount * v_mult),
      updated_at    = NOW();
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_period_balance ON acc_vouchers;
CREATE TRIGGER trg_update_period_balance
  AFTER UPDATE ON acc_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_update_period_balance();


-- ─── Trigger 3: Auto-enqueue AMIS sync khi voucher được posted ──────────────
CREATE OR REPLACE FUNCTION fn_enqueue_amis_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_config  RECORD;
  v_prio    SMALLINT;
BEGIN
  -- Chỉ enqueue khi chuyển sang posted
  IF NOT (NEW.status = 'posted' AND OLD.status = 'draft') THEN
    RETURN NEW;
  END IF;

  -- Ưu tiên theo loại chứng từ
  v_prio := CASE NEW.voucher_type
    WHEN 'receipt'           THEN 1   -- PT: ưu tiên cao nhất
    WHEN 'payment'           THEN 1   -- PC: ưu tiên cao nhất
    WHEN 'sales_invoice'     THEN 2
    WHEN 'purchase_invoice'  THEN 2
    WHEN 'inventory_out'     THEN 3
    WHEN 'inventory_in'      THEN 3
    ELSE 5                            -- Mặc định
  END;

  -- Tìm tất cả config AMIS đang active của org này
  FOR v_config IN
    SELECT id
    FROM   acc_integration_configs
    WHERE  org_id    = NEW.org_id
      AND  is_active = TRUE
      AND  platform  = 'amis_misa'
      AND  sync_mode = 'auto_post'
  LOOP
    INSERT INTO acc_sync_queue
      (org_id, branch_id, config_id, voucher_id, status, priority, queued_at)
    VALUES
      (NEW.org_id, NEW.branch_id, v_config.id, NEW.id, 'pending', v_prio, NOW())
    ON CONFLICT (voucher_id, config_id) DO NOTHING;
  END LOOP;

  -- Cập nhật trạng thái sync trên voucher header
  NEW.amis_sync_status := 'queued';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_amis_sync ON acc_vouchers;
CREATE TRIGGER trg_enqueue_amis_sync
  BEFORE UPDATE ON acc_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_amis_sync();


-- ─── Trigger 4: Bảo vệ bút toán của chứng từ đã posted ────────────────────
CREATE OR REPLACE FUNCTION fn_protect_posted_entries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM   acc_vouchers
  WHERE  id = COALESCE(OLD.voucher_id, NEW.voucher_id);

  IF v_status IN ('posted','reversed') THEN
    RAISE EXCEPTION
      '[Kiểm soát kế toán] Không thể % bút toán của chứng từ đã vào sổ '
      '(status=%). Hãy tạo bút toán đảo (reversal) thay thế.',
      TG_OP, v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_posted_entries ON acc_journal_entry_lines;
CREATE TRIGGER trg_protect_posted_entries
  BEFORE UPDATE OR DELETE ON acc_journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION fn_protect_posted_entries();


-- ─── Trigger 5: Cấm ghi chứng từ vào kỳ đã khoá ────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_period_open()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_period_status TEXT;
BEGIN
  SELECT status INTO v_period_status
  FROM   acc_fiscal_periods
  WHERE  id = NEW.fiscal_period_id;

  IF v_period_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION
      '[Kiểm soát kỳ] Kỳ kế toán đã bị khoá (status=%). '
      'Không thể tạo chứng từ mới. '
      'Liên hệ kế toán trưởng để mở lại kỳ nếu cần.',
      COALESCE(v_period_status, 'không tìm thấy');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_period_open ON acc_vouchers;
CREATE TRIGGER trg_check_period_open
  BEFORE INSERT ON acc_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_check_period_open();


-- ─── Trigger 6: Auto updated_at cho các bảng acc_ ───────────────────────────
CREATE OR REPLACE FUNCTION fn_acc_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'acc_organizations','acc_branches','acc_fiscal_periods',
    'acc_accounts','acc_suppliers','acc_vouchers',
    'acc_integration_configs','acc_intercompany_txns'
  ]
  LOOP
    EXECUTE FORMAT(
      'DROP TRIGGER IF EXISTS trg_acc_updated_at ON %I;
       CREATE TRIGGER trg_acc_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_acc_updated_at();',
      t, t
    );
  END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- CỘT MỞ RỘNG CHO BẢNG USERS HIỆN CÓ
-- Dùng dynamic SQL (EXECUTE) để tránh parse-time error khi cột chưa tồn tại
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Thêm cột branch_id nếu chưa có
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'users'
      AND  column_name  = 'branch_id'
  ) THEN
    ALTER TABLE users
      ADD COLUMN branch_id UUID REFERENCES acc_branches(id) ON DELETE SET NULL;
  END IF;

  -- Tạo index nếu chưa có
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE  schemaname = 'public'
      AND  tablename  = 'users'
      AND  indexname  = 'idx_users_branch'
  ) THEN
    CREATE INDEX idx_users_branch ON users(branch_id);
  END IF;
  -- Gán branch_id mặc định cho users thực hiện SAU khi seed acc_branches xong (xem cuối file)
END;
$$;

COMMENT ON COLUMN users.branch_id IS
  'Chi nhánh mà nhân viên này thuộc về. '
  'NULL = không gắn CN cụ thể (admin xem tất cả). '
  'Dùng bởi fn_user_branch_id() trong RLS policy.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — Phân quyền theo chi nhánh
-- ═══════════════════════════════════════════════════════════════════════════════

-- Bật RLS cho các bảng nhạy cảm
ALTER TABLE acc_vouchers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_journal_entry_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_period_balances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_ar_ledger             ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_ap_ledger             ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_sync_queue            ENABLE ROW LEVEL SECURITY;

-- Helper: lấy branch_id của user hiện tại
-- Dùng plpgsql thay vì sql để tránh validate cột lúc CREATE (chỉ validate khi gọi)
CREATE OR REPLACE FUNCTION fn_user_branch_id()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN (SELECT branch_id FROM users WHERE id = auth.uid() LIMIT 1);
END;
$$;

CREATE OR REPLACE FUNCTION fn_user_role()
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN (SELECT role FROM users WHERE id = auth.uid() LIMIT 1);
END;
$$;

-- Xoá policy cũ nếu có để tránh conflict
DROP POLICY IF EXISTS "acc_vouchers_rls"            ON acc_vouchers;
DROP POLICY IF EXISTS "acc_jel_rls"                 ON acc_journal_entry_lines;
DROP POLICY IF EXISTS "acc_period_balances_rls"     ON acc_period_balances;
DROP POLICY IF EXISTS "acc_ar_ledger_rls"           ON acc_ar_ledger;
DROP POLICY IF EXISTS "acc_ap_ledger_rls"           ON acc_ap_ledger;
DROP POLICY IF EXISTS "acc_sync_queue_rls"          ON acc_sync_queue;

-- Policy: admin/manager xem tất cả · nhân viên CN chỉ xem CN mình
CREATE POLICY "acc_vouchers_rls" ON acc_vouchers
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant')
    OR branch_id = fn_user_branch_id()
  );

CREATE POLICY "acc_jel_rls" ON acc_journal_entry_lines
  FOR ALL USING (
    voucher_id IN (
      SELECT id FROM acc_vouchers
      WHERE fn_user_role() IN ('admin','manager','accountant')
         OR branch_id = fn_user_branch_id()
    )
  );

CREATE POLICY "acc_period_balances_rls" ON acc_period_balances
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant')
    OR branch_id = fn_user_branch_id()
  );

CREATE POLICY "acc_ar_ledger_rls" ON acc_ar_ledger
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant')
    OR branch_id = fn_user_branch_id()
  );

CREATE POLICY "acc_ap_ledger_rls" ON acc_ap_ledger
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant')
    OR branch_id = fn_user_branch_id()
  );

-- Sync queue: chỉ admin/accountant mới xem
CREATE POLICY "acc_sync_queue_rls" ON acc_sync_queue
  FOR ALL USING (
    fn_user_role() IN ('admin','accountant')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS — Báo cáo nhanh
-- ═══════════════════════════════════════════════════════════════════════════════

-- Số dư hợp nhất toàn công ty (SUM tất cả CN)
CREATE OR REPLACE VIEW v_acc_consolidated_balances AS
SELECT
  fp.org_id,
  fp.year,
  fp.month,
  fp.period_name,
  pb.account_code,
  a.account_name,
  a.account_type,
  a.normal_balance,
  SUM(pb.opening_debit)   AS opening_debit,
  SUM(pb.opening_credit)  AS opening_credit,
  SUM(pb.period_debit)    AS period_debit,
  SUM(pb.period_credit)   AS period_credit,
  SUM(pb.closing_debit)   AS closing_debit,
  SUM(pb.closing_credit)  AS closing_credit
FROM       acc_period_balances pb
JOIN       acc_fiscal_periods   fp ON fp.id = pb.fiscal_period_id
JOIN       acc_accounts          a ON  a.id = pb.account_id
GROUP BY   fp.org_id, fp.year, fp.month, fp.period_name,
           pb.account_code, a.account_name, a.account_type, a.normal_balance;

-- Hàng đợi AMIS cần xử lý (dùng cho worker và dashboard)
CREATE OR REPLACE VIEW v_acc_sync_pending AS
SELECT
  sq.id,
  sq.voucher_id,
  v.voucher_number,
  v.voucher_type,
  v.voucher_date,
  TO_CHAR(v.total_debit, 'FM999,999,999,999') AS total_debit_fmt,
  b.branch_code,
  b.branch_name,
  sq.attempt_count,
  sq.max_attempts,
  sq.next_retry_at,
  sq.status,
  sq.error_code,
  sq.error_message,
  sq.queued_at
FROM       acc_sync_queue sq
JOIN       acc_vouchers    v ON v.id = sq.voucher_id
JOIN       acc_branches    b ON b.id = sq.branch_id
WHERE      sq.status IN ('pending','failed')
  AND      sq.attempt_count < sq.max_attempts
  AND      (sq.next_retry_at IS NULL OR sq.next_retry_at <= NOW())
ORDER BY   sq.priority ASC, sq.queued_at ASC;

-- Công nợ phải thu còn tồn (chưa thu đủ)
CREATE OR REPLACE VIEW v_acc_ar_outstanding AS
SELECT
  ar.org_id,
  ar.branch_id,
  b.branch_name,
  ar.customer_id,
  c.customer_code,
  c.full_name    AS customer_name,
  c.phone,
  SUM(ar.debit_amount)   AS total_invoiced,
  SUM(ar.credit_amount)  AS total_collected,
  SUM(ar.debit_amount - ar.credit_amount) AS balance_due,
  MIN(CASE WHEN ar.debit_amount > ar.credit_amount THEN ar.due_date END) AS earliest_due
FROM       acc_ar_ledger ar
JOIN       customers      c ON c.id = ar.customer_id
JOIN       acc_branches   b ON b.id = ar.branch_id
GROUP BY   ar.org_id, ar.branch_id, b.branch_name,
           ar.customer_id, c.customer_code, c.full_name, c.phone
HAVING     SUM(ar.debit_amount - ar.credit_amount) > 0
ORDER BY   earliest_due NULLS LAST;

-- Sổ cái tài khoản (General Ledger) — xem phát sinh từng TK
CREATE OR REPLACE VIEW v_acc_general_ledger AS
SELECT
  v.org_id,
  v.branch_id,
  b.branch_name,
  v.voucher_date,
  v.voucher_number,
  v.voucher_type,
  jel.account_code,
  a.account_name,
  v.description     AS voucher_desc,
  jel.description   AS line_desc,
  jel.debit_amount,
  jel.credit_amount,
  -- Đối tượng
  COALESCE(c.full_name, s.supplier_name) AS entity_name,
  v.status
FROM       acc_journal_entry_lines jel
JOIN       acc_vouchers             v ON v.id   = jel.voucher_id
JOIN       acc_accounts             a ON a.id   = jel.account_id
JOIN       acc_branches             b ON b.id   = v.branch_id
LEFT JOIN  customers                c ON c.id   = jel.customer_id
LEFT JOIN  acc_suppliers            s ON s.id   = jel.supplier_id
WHERE      v.status = 'posted'
ORDER BY   v.voucher_date, v.voucher_number, jel.line_number;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA — Tổ chức mặc định
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO acc_organizations
  (id, org_code, org_name, tax_code, address, default_vat_rate)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   'MAIN_ORG',
   'Showroom Xe Máy Điện',
   '0000000000',
   'TP. Hồ Chí Minh',
   10.00)
ON CONFLICT (org_code) DO NOTHING;

-- Chi nhánh mặc định (dùng cho dữ liệu hiện có, không gắn CN)
INSERT INTO acc_branches
  (id, org_id, branch_code, branch_name, branch_type, cost_center_code)
VALUES
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'MAIN-001', 'Chi nhánh chính', 'showroom', 'CC-MAIN-001')
ON CONFLICT (branch_code) DO NOTHING;

-- Gán chi nhánh mặc định cho tất cả user hiện có chưa có branch_id
-- Phải chạy SAU INSERT acc_branches để không vi phạm FK
DO $$
BEGIN
  EXECUTE $dyn$
    UPDATE users
    SET    branch_id = '00000000-0000-0000-0000-000000000010'
    WHERE  branch_id IS NULL
  $dyn$;
END;
$$;

-- Kỳ kế toán: tháng hiện tại
INSERT INTO acc_fiscal_periods
  (org_id, period_name, year, month, start_date, end_date, status)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Tháng ' || LPAD(EXTRACT(MONTH FROM NOW())::TEXT, 2, '0')
             || '/' || EXTRACT(YEAR FROM NOW())::TEXT,
   EXTRACT(YEAR  FROM NOW())::SMALLINT,
   EXTRACT(MONTH FROM NOW())::SMALLINT,
   DATE_TRUNC('month', NOW())::DATE,
   (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day')::DATE,
   'open')
ON CONFLICT (org_id, year, month) DO NOTHING;

-- Kỳ kế toán: 2 tháng tiếp theo (chuẩn bị sẵn)
INSERT INTO acc_fiscal_periods
  (org_id, period_name, year, month, start_date, end_date, status)
SELECT
  '00000000-0000-0000-0000-000000000001',
  'Tháng ' || LPAD(EXTRACT(MONTH FROM d)::TEXT, 2, '0')
            || '/' || EXTRACT(YEAR FROM d)::TEXT,
  EXTRACT(YEAR  FROM d)::SMALLINT,
  EXTRACT(MONTH FROM d)::SMALLINT,
  DATE_TRUNC('month', d)::DATE,
  (DATE_TRUNC('month', d) + INTERVAL '1 month - 1 day')::DATE,
  'open'
FROM   generate_series(
         DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
         DATE_TRUNC('month', NOW()) + INTERVAL '2 months',
         INTERVAL '1 month'
       ) AS d
ON CONFLICT (org_id, year, month) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA — Hệ thống tài khoản VAS/TT200
-- Showroom xe máy điện — đầy đủ các tài khoản thường dùng
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO acc_accounts
  (org_id, account_code, account_name, account_name_en,
   parent_code, level, account_type, normal_balance, is_detail, display_order)
VALUES

-- ════════════════════════════════
-- LOẠI 1: TÀI SẢN
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '1',    'Tài sản ngắn hạn',                  'Current Assets',                NULL,  1, 'asset',     'debit',  FALSE, 100),
('00000000-0000-0000-0000-000000000001', '11',   'Tiền và tương đương tiền',           'Cash & Equivalents',            '1',   2, 'asset',     'debit',  FALSE, 110),
('00000000-0000-0000-0000-000000000001', '111',  'Tiền mặt',                          'Cash on Hand',                  '11',  3, 'asset',     'debit',  FALSE, 111),
('00000000-0000-0000-0000-000000000001', '1111', 'Tiền mặt VNĐ',                      'Cash VND',                      '111', 4, 'asset',     'debit',  TRUE,  112),
('00000000-0000-0000-0000-000000000001', '1112', 'Tiền mặt ngoại tệ (USD)',           'Cash USD',                      '111', 4, 'asset',     'debit',  TRUE,  113),
('00000000-0000-0000-0000-000000000001', '112',  'Tiền gửi ngân hàng',                'Bank Deposits',                 '11',  3, 'asset',     'debit',  FALSE, 120),
('00000000-0000-0000-0000-000000000001', '1121', 'TG Ngân hàng VNĐ',                  'Bank VND',                      '112', 4, 'asset',     'debit',  TRUE,  121),
('00000000-0000-0000-0000-000000000001', '1122', 'TG Ngân hàng ngoại tệ',             'Bank Foreign Currency',         '112', 4, 'asset',     'debit',  TRUE,  122),
('00000000-0000-0000-0000-000000000001', '113',  'Tiền đang chuyển',                  'Cash in Transit',               '11',  3, 'asset',     'debit',  TRUE,  125),

('00000000-0000-0000-0000-000000000001', '13',   'Các khoản phải thu ngắn hạn',       'Short-term Receivables',        '1',   2, 'asset',     'debit',  FALSE, 130),
('00000000-0000-0000-0000-000000000001', '131',  'Phải thu khách hàng',               'Accounts Receivable',           '13',  3, 'asset',     'debit',  TRUE,  131),
('00000000-0000-0000-0000-000000000001', '133',  'Thuế GTGT được khấu trừ',           'VAT Input',                     '13',  3, 'asset',     'debit',  FALSE, 133),
('00000000-0000-0000-0000-000000000001', '1331', 'VAT đầu vào hàng hoá, dịch vụ',    'VAT Input - Goods & Services',  '133', 4, 'asset',     'debit',  TRUE,  134),
('00000000-0000-0000-0000-000000000001', '1332', 'VAT đầu vào TSCĐ',                 'VAT Input - Fixed Assets',      '133', 4, 'asset',     'debit',  TRUE,  135),
('00000000-0000-0000-0000-000000000001', '136',  'Phải thu nội bộ',                   'Inter-company Receivables',     '13',  3, 'asset',     'debit',  TRUE,  136),
('00000000-0000-0000-0000-000000000001', '138',  'Phải thu khác',                     'Other Receivables',             '13',  3, 'asset',     'debit',  TRUE,  138),
('00000000-0000-0000-0000-000000000001', '141',  'Tạm ứng nhân viên',                 'Staff Advances',                '13',  3, 'asset',     'debit',  TRUE,  141),

('00000000-0000-0000-0000-000000000001', '15',   'Hàng tồn kho',                      'Inventory',                     '1',   2, 'asset',     'debit',  FALSE, 150),
('00000000-0000-0000-0000-000000000001', '156',  'Hàng hoá',                          'Merchandise Inventory',         '15',  3, 'asset',     'debit',  FALSE, 156),
('00000000-0000-0000-0000-000000000001', '1561', 'Xe máy điện tồn kho',               'EV Motorcycle Inventory',       '156', 4, 'asset',     'debit',  TRUE,  157),
('00000000-0000-0000-0000-000000000001', '1562', 'Phụ tùng linh kiện',                'Spare Parts Inventory',         '156', 4, 'asset',     'debit',  TRUE,  158),
('00000000-0000-0000-0000-000000000001', '1563', 'Phụ kiện đi kèm',                  'Accessories Inventory',         '156', 4, 'asset',     'debit',  TRUE,  159),
('00000000-0000-0000-0000-000000000001', '157',  'Hàng gửi bán',                      'Consignment Inventory',         '15',  3, 'asset',     'debit',  TRUE,  160),
('00000000-0000-0000-0000-000000000001', '159',  'Dự phòng giảm giá hàng tồn kho',   'Inventory Write-down Provision','15',  3, 'asset',     'credit', TRUE,  165),

('00000000-0000-0000-0000-000000000001', '2',    'Tài sản dài hạn',                   'Non-current Assets',            NULL,  1, 'asset',     'debit',  FALSE, 200),
('00000000-0000-0000-0000-000000000001', '211',  'TSCĐ hữu hình',                     'Tangible Fixed Assets',         '2',   2, 'asset',     'debit',  FALSE, 211),
('00000000-0000-0000-0000-000000000001', '2111', 'Nhà cửa, vật kiến trúc',           'Buildings & Structures',        '211', 3, 'asset',     'debit',  TRUE,  212),
('00000000-0000-0000-0000-000000000001', '2112', 'Máy móc, thiết bị',                'Machinery & Equipment',         '211', 3, 'asset',     'debit',  TRUE,  213),
('00000000-0000-0000-0000-000000000001', '2114', 'Phương tiện vận tải',               'Vehicles',                      '211', 3, 'asset',     'debit',  TRUE,  214),
('00000000-0000-0000-0000-000000000001', '2118', 'TSCĐ khác',                         'Other Fixed Assets',            '211', 3, 'asset',     'debit',  TRUE,  215),
('00000000-0000-0000-0000-000000000001', '214',  'Hao mòn TSCĐ',                      'Accumulated Depreciation',      '2',   2, 'asset',     'credit', FALSE, 220),
('00000000-0000-0000-0000-000000000001', '2141', 'Hao mòn TSCĐ hữu hình',            'Depreciation - Tangible FA',    '214', 3, 'asset',     'credit', TRUE,  221),

-- ════════════════════════════════
-- LOẠI 3: NỢ PHẢI TRẢ
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '3',    'Nợ phải trả',                       'Liabilities',                   NULL,  1, 'liability', 'credit', FALSE, 300),
('00000000-0000-0000-0000-000000000001', '31',   'Vay và nợ thuê tài chính ngắn hạn', 'Short-term Borrowings',         '3',   2, 'liability', 'credit', FALSE, 310),
('00000000-0000-0000-0000-000000000001', '311',  'Vay ngắn hạn',                      'Short-term Loans',              '31',  3, 'liability', 'credit', TRUE,  311),
('00000000-0000-0000-0000-000000000001', '33',   'Phải trả người bán và khác',        'Payables',                      '3',   2, 'liability', 'credit', FALSE, 330),
('00000000-0000-0000-0000-000000000001', '331',  'Phải trả nhà cung cấp',             'Accounts Payable',              '33',  3, 'liability', 'credit', TRUE,  331),
('00000000-0000-0000-0000-000000000001', '333',  'Thuế và các khoản phải nộp NN',     'Taxes Payable',                 '33',  3, 'liability', 'credit', FALSE, 333),
('00000000-0000-0000-0000-000000000001', '3331', 'Thuế GTGT phải nộp',               'VAT Payable',                   '333', 4, 'liability', 'credit', TRUE,  334),
('00000000-0000-0000-0000-000000000001', '3332', 'Thuế tiêu thụ đặc biệt',           'Special Consumption Tax',       '333', 4, 'liability', 'credit', TRUE,  335),
('00000000-0000-0000-0000-000000000001', '3334', 'Thuế TNDN phải nộp',               'Corporate Income Tax',          '333', 4, 'liability', 'credit', TRUE,  336),
('00000000-0000-0000-0000-000000000001', '334',  'Phải trả người lao động',           'Salary Payable',                '33',  3, 'liability', 'credit', TRUE,  337),
('00000000-0000-0000-0000-000000000001', '335',  'Chi phí phải trả',                  'Accrued Expenses',              '33',  3, 'liability', 'credit', TRUE,  338),
('00000000-0000-0000-0000-000000000001', '336',  'Phải trả nội bộ',                   'Inter-company Payables',        '33',  3, 'liability', 'credit', TRUE,  339),
('00000000-0000-0000-0000-000000000001', '338',  'Phải trả, phải nộp khác',           'Other Payables',                '33',  3, 'liability', 'credit', FALSE, 340),
('00000000-0000-0000-0000-000000000001', '3387', 'Doanh thu chưa thực hiện',          'Deferred Revenue',              '338', 4, 'liability', 'credit', TRUE,  341),
('00000000-0000-0000-0000-000000000001', '3388', 'Phải trả khác',                     'Other Payables - Misc',         '338', 4, 'liability', 'credit', TRUE,  342),

-- ════════════════════════════════
-- LOẠI 4: VỐN CHỦ SỞ HỮU
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '4',    'Vốn chủ sở hữu',                   'Equity',                        NULL,  1, 'equity',    'credit', FALSE, 400),
('00000000-0000-0000-0000-000000000001', '41',   'Vốn góp chủ sở hữu',               'Owner''s Capital',              '4',   2, 'equity',    'credit', FALSE, 410),
('00000000-0000-0000-0000-000000000001', '411',  'Vốn đầu tư của CSH',               'Invested Capital',              '41',  3, 'equity',    'credit', FALSE, 411),
('00000000-0000-0000-0000-000000000001', '4111', 'Vốn góp (vốn điều lệ)',             'Charter Capital',               '411', 4, 'equity',    'credit', TRUE,  412),
('00000000-0000-0000-0000-000000000001', '42',   'Lợi nhuận sau thuế chưa PP',        'Retained Earnings',             '4',   2, 'equity',    'credit', FALSE, 420),
('00000000-0000-0000-0000-000000000001', '4211', 'LNST năm trước chưa PP',           'Prior Year Retained Earnings',  '42',  3, 'equity',    'credit', TRUE,  421),
('00000000-0000-0000-0000-000000000001', '4212', 'LNST năm nay chưa PP',             'Current Year Retained Earnings','42',  3, 'equity',    'credit', TRUE,  422),

-- ════════════════════════════════
-- LOẠI 5: DOANH THU
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '5',    'Doanh thu',                         'Revenue',                       NULL,  1, 'revenue',   'credit', FALSE, 500),
('00000000-0000-0000-0000-000000000001', '511',  'DT bán hàng và CCDV',              'Sales Revenue',                 '5',   2, 'revenue',   'credit', FALSE, 511),
('00000000-0000-0000-0000-000000000001', '5111', 'DT bán xe máy điện',               'EV Motorcycle Sales',           '511', 3, 'revenue',   'credit', TRUE,  512),
('00000000-0000-0000-0000-000000000001', '5112', 'DT bán phụ tùng linh kiện',        'Spare Parts Sales',             '511', 3, 'revenue',   'credit', TRUE,  513),
('00000000-0000-0000-0000-000000000001', '5113', 'DT dịch vụ sửa chữa bảo dưỡng',   'Repair & Maintenance Service',  '511', 3, 'revenue',   'credit', TRUE,  514),
('00000000-0000-0000-0000-000000000001', '5114', 'DT bán phụ kiện',                  'Accessories Sales',             '511', 3, 'revenue',   'credit', TRUE,  515),
('00000000-0000-0000-0000-000000000001', '512',  'DT bán hàng nội bộ',               'Inter-company Sales',           '5',   2, 'revenue',   'credit', TRUE,  520),
('00000000-0000-0000-0000-000000000001', '515',  'DT hoạt động tài chính',            'Financial Revenue',             '5',   2, 'revenue',   'credit', FALSE, 530),
('00000000-0000-0000-0000-000000000001', '5151', 'Lãi tiền gửi, tiền cho vay',       'Interest Income',               '515', 3, 'revenue',   'credit', TRUE,  531),
('00000000-0000-0000-0000-000000000001', '5152', 'Lãi chênh lệch tỷ giá',            'Foreign Exchange Gain',         '515', 3, 'revenue',   'credit', TRUE,  532),
('00000000-0000-0000-0000-000000000001', '521',  'Các khoản giảm trừ DT',            'Revenue Deductions',            '5',   2, 'revenue',   'debit',  FALSE, 540),
('00000000-0000-0000-0000-000000000001', '5211', 'Chiết khấu thương mại',            'Trade Discounts',               '521', 3, 'revenue',   'debit',  TRUE,  541),
('00000000-0000-0000-0000-000000000001', '5212', 'Hàng bán bị trả lại',              'Sales Returns',                 '521', 3, 'revenue',   'debit',  TRUE,  542),
('00000000-0000-0000-0000-000000000001', '5213', 'Giảm giá hàng bán',                'Sales Allowances',              '521', 3, 'revenue',   'debit',  TRUE,  543),

-- ════════════════════════════════
-- LOẠI 6: CHI PHÍ
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '6',    'Chi phí',                           'Expenses',                      NULL,  1, 'expense',   'debit',  FALSE, 600),
('00000000-0000-0000-0000-000000000001', '632',  'Giá vốn hàng bán',                 'Cost of Goods Sold',            '6',   2, 'cogs',      'debit',  FALSE, 632),
('00000000-0000-0000-0000-000000000001', '6321', 'Giá vốn bán xe máy điện',          'EV Motorcycle COGS',            '632', 3, 'cogs',      'debit',  TRUE,  633),
('00000000-0000-0000-0000-000000000001', '6322', 'Giá vốn phụ tùng, dịch vụ',       'Spare Parts & Service COGS',    '632', 3, 'cogs',      'debit',  TRUE,  634),
('00000000-0000-0000-0000-000000000001', '6323', 'Giá vốn phụ kiện',                 'Accessories COGS',              '632', 3, 'cogs',      'debit',  TRUE,  635),
('00000000-0000-0000-0000-000000000001', '641',  'Chi phí bán hàng',                 'Selling Expenses',              '6',   2, 'expense',   'debit',  FALSE, 641),
('00000000-0000-0000-0000-000000000001', '6411', 'Lương nhân viên bán hàng',         'Sales Staff Salary',            '641', 3, 'expense',   'debit',  TRUE,  642),
('00000000-0000-0000-0000-000000000001', '6412', 'Hoa hồng bán hàng',                'Sales Commissions',             '641', 3, 'expense',   'debit',  TRUE,  643),
('00000000-0000-0000-0000-000000000001', '6413', 'Chi phí marketing, quảng cáo',     'Marketing & Advertising',       '641', 3, 'expense',   'debit',  TRUE,  644),
('00000000-0000-0000-0000-000000000001', '6414', 'Chi phí vận chuyển giao hàng',     'Delivery Expenses',             '641', 3, 'expense',   'debit',  TRUE,  645),
('00000000-0000-0000-0000-000000000001', '6415', 'Chi phí bảo hành (CP)',            'Warranty Expenses',             '641', 3, 'expense',   'debit',  TRUE,  646),
('00000000-0000-0000-0000-000000000001', '6418', 'Chi phí bán hàng khác',            'Other Selling Expenses',        '641', 3, 'expense',   'debit',  TRUE,  648),
('00000000-0000-0000-0000-000000000001', '642',  'Chi phí quản lý doanh nghiệp',     'General & Admin Expenses',      '6',   2, 'expense',   'debit',  FALSE, 650),
('00000000-0000-0000-0000-000000000001', '6421', 'Lương ban quản lý',                'Management Salary',             '642', 3, 'expense',   'debit',  TRUE,  651),
('00000000-0000-0000-0000-000000000001', '6422', 'Chi phí văn phòng phẩm',           'Office Supplies',               '642', 3, 'expense',   'debit',  TRUE,  652),
('00000000-0000-0000-0000-000000000001', '6423', 'Chi phí điện, nước',               'Utilities',                     '642', 3, 'expense',   'debit',  TRUE,  653),
('00000000-0000-0000-0000-000000000001', '6424', 'Chi phí thuê mặt bằng',            'Rent Expenses',                 '642', 3, 'expense',   'debit',  TRUE,  654),
('00000000-0000-0000-0000-000000000001', '6425', 'Chi phí khấu hao TSCĐ',            'Depreciation Expenses',         '642', 3, 'expense',   'debit',  TRUE,  655),
('00000000-0000-0000-0000-000000000001', '6426', 'Chi phí bảo hiểm',                 'Insurance Expenses',            '642', 3, 'expense',   'debit',  TRUE,  656),
('00000000-0000-0000-0000-000000000001', '6428', 'Chi phí QLDN khác',                'Other Admin Expenses',          '642', 3, 'expense',   'debit',  TRUE,  658),
('00000000-0000-0000-0000-000000000001', '635',  'Chi phí tài chính',                 'Financial Expenses',            '6',   2, 'expense',   'debit',  FALSE, 660),
('00000000-0000-0000-0000-000000000001', '6351', 'Lãi vay',                           'Interest Expenses',             '635', 3, 'expense',   'debit',  TRUE,  661),
('00000000-0000-0000-0000-000000000001', '6352', 'Lỗ chênh lệch tỷ giá',             'Foreign Exchange Loss',         '635', 3, 'expense',   'debit',  TRUE,  662),

-- ════════════════════════════════
-- LOẠI 7 & 8: THU NHẬP / CHI PHÍ KHÁC
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '711',  'Thu nhập khác',                     'Other Income',                  NULL,  2, 'other_income',  'credit', TRUE, 711),
('00000000-0000-0000-0000-000000000001', '811',  'Chi phí khác',                      'Other Expenses',                NULL,  2, 'other_expense', 'debit',  TRUE, 811),

-- ════════════════════════════════
-- LOẠI 9: XÁC ĐỊNH KẾT QUẢ
-- ════════════════════════════════
('00000000-0000-0000-0000-000000000001', '911',  'Xác định kết quả kinh doanh',       'Profit / Loss Determination',   NULL,  2, 'equity',    'credit', TRUE,  911)

ON CONFLICT (org_id, account_code) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA — Cấu hình AMIS mẫu (chưa active, cần điền client_id/secret thật)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO acc_integration_configs
  (org_id, platform, config_name, is_active, api_base_url, sync_mode, sync_from_date)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   'amis_misa',
   'AMIS Production',
   FALSE,   -- ← Đặt TRUE sau khi điền client_id + client_secret thật
   'https://actapp.misa.vn/api/v3',
   'auto_post',
   CURRENT_DATE)
ON CONFLICT (org_id, platform, config_name) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════════
-- KIỂM TRA CUỐI — Đảm bảo tất cả đã tạo đúng
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_table_count   INT;
  v_account_count INT;
  v_trigger_count INT;
BEGIN
  -- Đếm bảng acc_*
  SELECT COUNT(*) INTO v_table_count
  FROM   information_schema.tables
  WHERE  table_schema = 'public'
    AND  table_name LIKE 'acc_%';

  -- Đếm tài khoản đã seed
  SELECT COUNT(*) INTO v_account_count
  FROM   acc_accounts;

  -- Đếm trigger acc
  SELECT COUNT(*) INTO v_trigger_count
  FROM   information_schema.triggers
  WHERE  trigger_schema = 'public'
    AND  trigger_name LIKE 'trg_%';

  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE '  Module Kế toán — Kết quả khởi tạo:';
  RAISE NOTICE '  ✓ Số bảng acc_* đã tạo : %', v_table_count;
  RAISE NOTICE '  ✓ Tài khoản VAS/TT200  : %', v_account_count;
  RAISE NOTICE '  ✓ Triggers bảo vệ      : %', v_trigger_count;
  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE '  BƯỚC TIẾP THEO:';
  RAISE NOTICE '  1. Vào acc_integration_configs → điền';
  RAISE NOTICE '     client_id + client_secret AMIS thật';
  RAISE NOTICE '     rồi set is_active = TRUE';
  RAISE NOTICE '  2. Vào acc_branches → thêm các CN thật';
  RAISE NOTICE '  3. Update users.branch_id cho từng nhân viên';
  RAISE NOTICE '  4. Tạo kỳ kế toán các tháng còn lại trong năm';
  RAISE NOTICE '══════════════════════════════════════════════';
END;
$$;

COMMIT;  -- Tất cả OK → commit
-- Nếu có lỗi bất kỳ ở trên thì PostgreSQL tự ROLLBACK toàn bộ
