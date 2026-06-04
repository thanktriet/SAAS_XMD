-- ============================================================
-- SEED: fiscal_year_2026

-- ============================================================

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-0000-0000-000000000001';
  v_fy_id  UUID;
  m        INTEGER;
  v_start  DATE;
  v_end    DATE;
  v_status TEXT;
BEGIN

  SELECT id INTO v_fy_id FROM acc_fiscal_years WHERE year = 2026;

  IF v_fy_id IS NULL THEN
    INSERT INTO acc_fiscal_years (year, start_date, end_date, status, notes)
    VALUES (2026, '2026-01-01', '2026-12-31', 'open', 'Nm ti chnh 2026')
    RETURNING id INTO v_fy_id;
  END IF;

  FOR m IN 1..12 LOOP
    v_start := make_date(2026, m, 1);
    v_end   := (v_start + INTERVAL '1 month - 1 day')::DATE;

    v_status := CASE
      WHEN m <= 2 THEN 'locked'
      WHEN m = 3  THEN 'closed'
      ELSE             'open'
    END;

    INSERT INTO acc_fiscal_periods
      (org_id, fiscal_year_id, period, period_name,
       year, month, start_date, end_date, status)
    VALUES
      (v_org_id, v_fy_id, m,
       'Thng ' || m || '/2026',
       2026, m, v_start, v_end, v_status)
    ON CONFLICT (org_id, year, month) DO UPDATE
      SET fiscal_year_id = EXCLUDED.fiscal_year_id,
          period         = EXCLUDED.period;
  END LOOP;

END $$;
