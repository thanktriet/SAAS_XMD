-- ============================================================
-- MIGRATION: add_accounting_foundation_v2

-- ============================================================

ALTER TABLE acc_accounts
  ADD COLUMN IF NOT EXISTS account_number TEXT;

UPDATE acc_accounts
SET    account_number = account_code
WHERE  account_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_accounts_number_unique
  ON acc_accounts(account_number)
  WHERE account_number IS NOT NULL;

ALTER TABLE acc_accounts
  ADD COLUMN IF NOT EXISTS account_group   TEXT CHECK (account_group IN (
    'group_1','group_2','group_3','group_4','group_5',
    'group_6','group_7','group_8','group_9'
  )),
  ADD COLUMN IF NOT EXISTS is_system       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_id       UUID REFERENCES acc_accounts(id),
  ADD COLUMN IF NOT EXISTS name_en         TEXT,
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_balance NUMERIC(18,2) DEFAULT 0;

UPDATE acc_accounts SET account_group =
  CASE
    WHEN account_code ~ '^1' THEN 'group_1'
    WHEN account_code ~ '^2' THEN 'group_2'
    WHEN account_code ~ '^3' THEN 'group_3'
    WHEN account_code ~ '^4' THEN 'group_4'
    WHEN account_code ~ '^5' THEN 'group_5'
    WHEN account_code ~ '^6' THEN 'group_6'
    WHEN account_code ~ '^7' THEN 'group_7'
    WHEN account_code ~ '^8' THEN 'group_8'
    WHEN account_code ~ '^9' THEN 'group_9'
  END
WHERE account_group IS NULL;

UPDATE acc_accounts
SET    name_en = account_name_en
WHERE  name_en IS NULL AND account_name_en IS NOT NULL;

CREATE TABLE IF NOT EXISTS acc_fiscal_years (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  year        INTEGER NOT NULL UNIQUE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO acc_fiscal_years (year, start_date, end_date, status, notes)
VALUES (2026, '2026-01-01', '2026-12-31', 'open', 'Nm ti chnh 2026')
ON CONFLICT (year) DO NOTHING;

ALTER TABLE acc_fiscal_periods
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

UPDATE acc_fiscal_periods
SET    updated_at = created_at
WHERE  updated_at IS NULL;

ALTER TABLE acc_fiscal_periods
  ADD COLUMN IF NOT EXISTS fiscal_year_id UUID REFERENCES acc_fiscal_years(id),
  ADD COLUMN IF NOT EXISTS period         INTEGER CHECK (period BETWEEN 1 AND 13);

UPDATE acc_fiscal_periods fp
SET
  fiscal_year_id = fy.id,
  period         = fp.month
FROM acc_fiscal_years fy
WHERE fy.year = fp.year
  AND fp.fiscal_year_id IS NULL;

DROP TRIGGER IF EXISTS trg_acc_fiscal_years_updated_at ON acc_fiscal_years;
CREATE TRIGGER trg_acc_fiscal_years_updated_at
  BEFORE UPDATE ON acc_fiscal_years
  FOR EACH ROW EXECUTE FUNCTION fn_acc_updated_at();

-- Index
CREATE INDEX IF NOT EXISTS idx_acc_accounts_group   ON acc_accounts(account_group);
CREATE INDEX IF NOT EXISTS idx_acc_accounts_parent2 ON acc_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_acc_periods_year_fk  ON acc_fiscal_periods(fiscal_year_id);
