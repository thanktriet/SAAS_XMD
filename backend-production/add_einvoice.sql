-- ============================================================
-- MIGRATION: add_einvoice.sql
-- Creates: einvoices, einvoice_lines
-- Alters:  sales_orders, service_requests
-- Run AFTER: accounting.sql, schema.sql
-- Pure ASCII - safe for Supabase SQL Editor
-- ============================================================

BEGIN;

-- ============================================================
-- TABLE: einvoices
-- ============================================================
CREATE TABLE IF NOT EXISTS einvoices (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Invoice identity
  invoice_number      TEXT        UNIQUE,          -- Assigned by AMIS after issue
  invoice_series      TEXT        NOT NULL,        -- e.g. C23TTGT
  invoice_template    TEXT        NOT NULL DEFAULT '01GTKT0/001',
  invoice_type        TEXT        NOT NULL
    CHECK (invoice_type IN ('sale', 'service', 'adjustment')),

  -- Source document
  source_type         TEXT        NOT NULL
    CHECK (source_type IN ('sales_order', 'service_request')),
  source_id           UUID        NOT NULL,

  -- Linked accounting voucher (receipt)
  acc_voucher_id      UUID        REFERENCES acc_vouchers(id) ON DELETE SET NULL,

  -- Seller info (from acc_organizations)
  seller_name         TEXT        NOT NULL,
  seller_tax_code     TEXT        NOT NULL,
  seller_address      TEXT,

  -- Buyer info (from customers)
  buyer_name          TEXT        NOT NULL,
  buyer_tax_code      TEXT,
  buyer_address       TEXT,
  buyer_email         TEXT,

  -- Financials
  subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_rate            NUMERIC(5,2)  NOT NULL DEFAULT 10,
  vat_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Status
  status              TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'adjusted', 'cancelled')),
  issued_at           TIMESTAMPTZ,
  issued_by           UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- AMIS integration
  amis_einvoice_id    TEXT,        -- ID returned by AMIS after push
  amis_lookup_code    TEXT,        -- Public lookup code for invoice
  amis_pdf_url        TEXT,        -- PDF download URL from AMIS
  amis_sync_status    TEXT        NOT NULL DEFAULT 'pending'
    CHECK (amis_sync_status IN ('pending', 'queued', 'synced', 'failed')),
  amis_sync_error     TEXT,
  amis_synced_at      TIMESTAMPTZ,

  -- Adjustment / cancellation
  original_invoice_id UUID        REFERENCES einvoices(id) ON DELETE SET NULL,
  cancel_reason       TEXT,
  adjustment_note     TEXT,

  notes               TEXT,
  created_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: einvoice_lines
-- ============================================================
CREATE TABLE IF NOT EXISTS einvoice_lines (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  einvoice_id      UUID        NOT NULL REFERENCES einvoices(id) ON DELETE CASCADE,
  line_number      SMALLINT    NOT NULL,

  -- Item info
  item_type        TEXT        NOT NULL
    CHECK (item_type IN ('vehicle', 'service', 'part', 'fee', 'other')),
  item_name        TEXT        NOT NULL,
  unit             TEXT        NOT NULL DEFAULT 'Chiec',
  quantity         NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price       NUMERIC(15,2) NOT NULL,
  discount_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total       NUMERIC(15,2) NOT NULL,

  -- Tax
  vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 10,
  vat_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Accounting
  account_code     TEXT,

  -- Source traceability
  source_item_id   UUID,
  source_item_type TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (einvoice_id, line_number)
);

-- ============================================================
-- ALTER: sales_orders - add einvoice_id + invoice_issued status
-- ============================================================
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS einvoice_id UUID REFERENCES einvoices(id) ON DELETE SET NULL;

-- Thêm invoice_issued vào CHECK constraint (DROP + re-ADD vì PostgreSQL không ALTER CHECK)
ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_status_check;

ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN (
      'draft', 'confirmed', 'deposit_paid', 'full_paid',
      'invoice_requested', 'invoice_approved', 'invoice_issued',
      'pdi_pending', 'pdi_done',
      'delivered', 'cancelled'
    ));

-- ============================================================
-- ALTER: service_requests - add einvoice_id + new status value
-- ============================================================
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS einvoice_id UUID REFERENCES einvoices(id) ON DELETE SET NULL;

ALTER TABLE service_requests
  DROP CONSTRAINT IF EXISTS service_requests_status_check;

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_status_check
    CHECK (status IN (
      'received', 'diagnosing', 'waiting_parts', 'repairing',
      'done', 'invoice_issued', 'delivered', 'cancelled'
    ));

-- ============================================================
-- TRIGGER: auto-update updated_at on einvoices
-- ============================================================
DROP TRIGGER IF EXISTS trg_einvoices_updated_at ON einvoices;
CREATE TRIGGER trg_einvoices_updated_at
  BEFORE UPDATE ON einvoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_einvoices_source
  ON einvoices(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_einvoices_status
  ON einvoices(status);

CREATE INDEX IF NOT EXISTS idx_einvoices_amis_pending
  ON einvoices(amis_sync_status)
  WHERE amis_sync_status IN ('pending', 'queued', 'failed');

CREATE INDEX IF NOT EXISTS idx_einvoice_lines_inv
  ON einvoice_lines(einvoice_id);

-- ============================================================
-- VERIFY
-- ============================================================
DO $$
DECLARE
  v_einvoices      INT;
  v_einvoice_lines INT;
  v_sales_col      INT;
  v_service_col    INT;
BEGIN
  SELECT COUNT(*) INTO v_einvoices
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'einvoices';

  SELECT COUNT(*) INTO v_einvoice_lines
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'einvoice_lines';

  SELECT COUNT(*) INTO v_sales_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_orders'
    AND column_name = 'einvoice_id';

  SELECT COUNT(*) INTO v_service_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'service_requests'
    AND column_name = 'einvoice_id';

  RAISE NOTICE 'einvoices table      : %', CASE WHEN v_einvoices > 0      THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'einvoice_lines table : %', CASE WHEN v_einvoice_lines > 0 THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'sales_orders.einvoice_id    : %', CASE WHEN v_sales_col > 0   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'service_requests.einvoice_id: %', CASE WHEN v_service_col > 0 THEN 'OK' ELSE 'MISSING' END;

  IF v_einvoices = 0 OR v_einvoice_lines = 0 THEN
    RAISE EXCEPTION 'add_einvoice: table creation failed.';
  END IF;
END;
$$;

COMMIT;
