-- ============================================================
-- SEED: default organization and branch
-- Run AFTER accounting.sql
-- Pure ASCII - safe for Supabase SQL Editor
-- ============================================================

-- Default organization (fixed UUID used throughout the system)
INSERT INTO acc_organizations (
  id, org_code, org_name, tax_code, address, phone,
  fiscal_year_start, default_currency, default_vat_rate, is_active
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'ERP_XEMAYDEN',
  'Dai ly xe may dien',
  '0000000000',
  'Ha Noi, Viet Nam',
  '0900000000',
  1,
  'VND',
  10.00,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- Default branch (headquarters)
INSERT INTO acc_branches (
  id, org_id, branch_code, branch_name, branch_type,
  address, is_active
)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'HQ-001',
  'Tru so chinh',
  'headquarters',
  'Ha Noi, Viet Nam',
  TRUE
)
ON CONFLICT (branch_code) DO NOTHING;
