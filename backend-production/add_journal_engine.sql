-- ============================================================
-- MIGRATION: add_journal_engine.sql
-- Creates: v_acc_general_ledger, v_acc_income_statement,
--          fn_carry_forward_opening_balance
-- Run AFTER: accounting.sql, add_accounting_foundation.sql
-- Pure ASCII - safe for Supabase SQL Editor
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS v_acc_general_ledger   CASCADE;
DROP VIEW IF EXISTS v_acc_income_statement CASCADE;

-- ============================================================
-- VIEW 1: v_acc_general_ledger
-- General ledger - all posted journal entry lines
-- ============================================================
CREATE OR REPLACE VIEW v_acc_general_ledger AS
SELECT
  v.id                AS voucher_id,
  v.voucher_number,
  v.voucher_type,
  v.voucher_date,
  v.branch_id,
  b.branch_name,
  v.fiscal_period_id,
  fp.period_name,
  fp.year,
  fp.month,
  jel.account_id,
  a.account_code,
  a.account_name,
  a.account_type,
  a.normal_balance,
  jel.line_number,
  jel.description,
  jel.debit_amount,
  jel.credit_amount,
  jel.customer_id,
  jel.supplier_id
FROM       acc_journal_entry_lines  jel
JOIN       acc_vouchers             v   ON v.id   = jel.voucher_id
JOIN       acc_accounts             a   ON a.id   = jel.account_id
JOIN       acc_fiscal_periods       fp  ON fp.id  = v.fiscal_period_id
JOIN       acc_branches             b   ON b.id   = v.branch_id
WHERE      v.status = 'posted'
ORDER BY   v.voucher_date   DESC,
           v.voucher_number DESC,
           jel.line_number  ASC;

-- ============================================================
-- VIEW 2: v_acc_income_statement
-- P&L report grouped by account type and period
-- ============================================================
CREATE OR REPLACE VIEW v_acc_income_statement AS
SELECT
  pb.org_id,
  fp.year,
  fp.month,
  fp.period_name,
  a.account_code,
  a.account_name,
  a.account_type,
  a.normal_balance,
  pb.period_debit,
  pb.period_credit,
  CASE
    WHEN a.account_type IN ('revenue', 'other_income')
      THEN pb.period_credit - pb.period_debit
    WHEN a.account_type IN ('cogs', 'expense', 'other_expense')
      THEN pb.period_debit  - pb.period_credit
    ELSE 0
  END AS net_amount
FROM       acc_period_balances  pb
JOIN       acc_accounts         a   ON a.id  = pb.account_id
                                   AND a.account_type IN (
                                         'revenue', 'cogs', 'expense',
                                         'other_income', 'other_expense'
                                       )
JOIN       acc_fiscal_periods   fp  ON fp.id = pb.fiscal_period_id
ORDER BY   fp.year ASC, fp.month ASC,
           a.account_type ASC, a.account_code ASC;

-- ============================================================
-- FUNCTION: fn_carry_forward_opening_balance
-- Carries closing balances of previous period into opening
-- balances of the new period.
-- Param: p_fiscal_period_id - UUID of the TARGET (new) period
-- ============================================================
CREATE OR REPLACE FUNCTION fn_carry_forward_opening_balance(
  p_fiscal_period_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_period     RECORD;
  v_prev_period_id UUID;
  v_rows_processed INT := 0;
BEGIN

  -- Step 1: load target period
  SELECT id, org_id, year, month, period_name, status
  INTO   v_new_period
  FROM   acc_fiscal_periods
  WHERE  id = p_fiscal_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found: %', p_fiscal_period_id;
  END IF;

  IF v_new_period.status = 'closed' THEN
    RAISE EXCEPTION 'Period "%" is already closed. Re-open it first.',
      v_new_period.period_name;
  END IF;

  -- Step 2: find the immediately preceding period (same org)
  SELECT id
  INTO   v_prev_period_id
  FROM   acc_fiscal_periods
  WHERE  org_id = v_new_period.org_id
    AND  (year < v_new_period.year
          OR (year = v_new_period.year AND month < v_new_period.month))
  ORDER BY year DESC, month DESC
  LIMIT  1;

  IF v_prev_period_id IS NULL THEN
    RAISE EXCEPTION
      'No previous period found before period "%" (year=%, month=%). '
      'This may be the first period - enter opening balances manually.',
      v_new_period.period_name,
      v_new_period.year,
      v_new_period.month;
  END IF;

  -- Step 3: carry forward closing balances -> opening of new period
  INSERT INTO acc_period_balances
    (org_id, branch_id, fiscal_period_id, account_id, account_code,
     opening_debit, opening_credit, period_debit, period_credit)
  SELECT
    pb.org_id,
    pb.branch_id,
    p_fiscal_period_id,
    pb.account_id,
    pb.account_code,
    pb.closing_debit,
    pb.closing_credit,
    0,
    0
  FROM acc_period_balances pb
  WHERE pb.fiscal_period_id = v_prev_period_id
  ON CONFLICT (org_id, branch_id, fiscal_period_id, account_id)
  DO UPDATE SET
    opening_debit  = EXCLUDED.opening_debit,
    opening_credit = EXCLUDED.opening_credit,
    updated_at     = NOW();

  GET DIAGNOSTICS v_rows_processed = ROW_COUNT;

  RETURN FORMAT(
    'Carry forward complete. Source: %s -> Target: %s. Rows: %s.',
    v_prev_period_id::TEXT,
    p_fiscal_period_id::TEXT,
    v_rows_processed
  );

END;
$$;

-- ============================================================
-- VERIFY: confirm all objects were created
-- ============================================================
DO $$
DECLARE
  v_view_gl  INT;
  v_view_pnl INT;
  v_func_cf  INT;
BEGIN
  SELECT COUNT(*) INTO v_view_gl
  FROM   information_schema.views
  WHERE  table_schema = 'public'
    AND  table_name   = 'v_acc_general_ledger';

  SELECT COUNT(*) INTO v_view_pnl
  FROM   information_schema.views
  WHERE  table_schema = 'public'
    AND  table_name   = 'v_acc_income_statement';

  SELECT COUNT(*) INTO v_func_cf
  FROM   information_schema.routines
  WHERE  routine_schema = 'public'
    AND  routine_name   = 'fn_carry_forward_opening_balance';

  RAISE NOTICE 'v_acc_general_ledger   : %', CASE WHEN v_view_gl  > 0 THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'v_acc_income_statement : %', CASE WHEN v_view_pnl > 0 THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'fn_carry_forward       : %', CASE WHEN v_func_cf  > 0 THEN 'OK' ELSE 'MISSING' END;

  IF v_view_gl = 0 OR v_view_pnl = 0 OR v_func_cf = 0 THEN
    RAISE EXCEPTION 'add_journal_engine: one or more objects failed to create.';
  END IF;
END;
$$;

COMMIT;
