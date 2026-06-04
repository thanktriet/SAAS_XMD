-- ============================================================
-- DROP ACCOUNTING MODULE
-- Xoá toàn bộ module kế toán (acc_*, einvoices) khỏi database.
-- Giữ nguyên: sales_orders, service_requests, finance_transactions,
--             inventory, customers, warranty, spare_parts, users...
--
-- Chạy trong Supabase SQL Editor.
-- An toàn: dùng IF EXISTS + CASCADE ở mọi bước.
-- ============================================================

-- ============================================================
-- BƯỚC 1: XOÁ VIEWS
-- ============================================================
DROP VIEW IF EXISTS v_acc_general_ledger       CASCADE;
DROP VIEW IF EXISTS v_acc_ar_outstanding       CASCADE;
DROP VIEW IF EXISTS v_acc_sync_pending         CASCADE;
DROP VIEW IF EXISTS v_acc_consolidated_balances CASCADE;

-- ============================================================
-- BƯỚC 2: XOÁ TRIGGERS (trên bảng sẽ bị DROP — tự xoá theo CASCADE,
--         nhưng explicit để rõ ràng)
-- ============================================================
DROP TRIGGER IF EXISTS trg_validate_voucher_balance  ON acc_vouchers;
DROP TRIGGER IF EXISTS trg_update_period_balance     ON acc_journal_entry_lines;
DROP TRIGGER IF EXISTS trg_enqueue_amis_sync         ON acc_vouchers;
DROP TRIGGER IF EXISTS trg_protect_posted_entries    ON acc_journal_entry_lines;
DROP TRIGGER IF EXISTS trg_check_period_open         ON acc_vouchers;

-- Triggers updated_at trên bảng acc_*
DROP TRIGGER IF EXISTS trg_einvoices_updated_at      ON einvoices;

-- ============================================================
-- BƯỚC 3: XOÁ BẢNG — thứ tự từ lá lên gốc (child trước parent)
-- ============================================================

-- einvoice module (từ add_einvoice.sql)
DROP TABLE IF EXISTS einvoice_lines         CASCADE;
DROP TABLE IF EXISTS einvoices              CASCADE;

-- accounting module — bảng con trước
DROP TABLE IF EXISTS acc_sync_logs          CASCADE;
DROP TABLE IF EXISTS acc_sync_queue         CASCADE;
DROP TABLE IF EXISTS acc_account_mappings   CASCADE;
DROP TABLE IF EXISTS acc_intercompany_txns  CASCADE;
DROP TABLE IF EXISTS acc_ap_ledger          CASCADE;
DROP TABLE IF EXISTS acc_ar_ledger          CASCADE;
DROP TABLE IF EXISTS acc_period_balances    CASCADE;
DROP TABLE IF EXISTS acc_journal_entry_lines CASCADE;
DROP TABLE IF EXISTS acc_vouchers           CASCADE;
DROP TABLE IF EXISTS acc_integration_configs CASCADE;
DROP TABLE IF EXISTS acc_suppliers          CASCADE;
DROP TABLE IF EXISTS acc_accounts           CASCADE;
DROP TABLE IF EXISTS acc_fiscal_periods     CASCADE;
DROP TABLE IF EXISTS acc_branches           CASCADE;
DROP TABLE IF EXISTS acc_organizations      CASCADE;

-- ============================================================
-- BƯỚC 4: KHÔI PHỤC sales_orders — xoá einvoice_id, restore CHECK
-- ============================================================

-- Xoá FK + column einvoice_id
ALTER TABLE sales_orders
  DROP COLUMN IF EXISTS einvoice_id CASCADE;

-- Khôi phục CHECK constraint về trạng thái ban đầu (schema.sql gốc)
ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_status_check;

ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN (
      'draft', 'confirmed', 'deposit_paid', 'full_paid',
      'invoice_requested', 'invoice_approved',
      'pdi_pending', 'pdi_done',
      'delivered', 'cancelled'
    ));

-- ============================================================
-- BƯỚC 5: KHÔI PHỤC service_requests — xoá einvoice_id
-- ============================================================

ALTER TABLE service_requests
  DROP COLUMN IF EXISTS einvoice_id CASCADE;

-- Constraint gốc (không có invoice_issued)
ALTER TABLE service_requests
  DROP CONSTRAINT IF EXISTS service_requests_status_check;

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_status_check
    CHECK (status IN (
      'received', 'diagnosing', 'waiting_parts',
      'repairing', 'done', 'delivered', 'cancelled'
    ));

-- ============================================================
-- BƯỚC 6: XOÁ FUNCTIONS
-- ============================================================
DROP FUNCTION IF EXISTS fn_validate_voucher_balance()  CASCADE;
DROP FUNCTION IF EXISTS fn_update_period_balance()     CASCADE;
DROP FUNCTION IF EXISTS fn_enqueue_amis_sync()         CASCADE;
DROP FUNCTION IF EXISTS fn_protect_posted_entries()    CASCADE;
DROP FUNCTION IF EXISTS fn_check_period_open()         CASCADE;
DROP FUNCTION IF EXISTS fn_acc_updated_at()            CASCADE;
DROP FUNCTION IF EXISTS fn_user_branch_id()            CASCADE;
DROP FUNCTION IF EXISTS fn_user_role()                 CASCADE;

-- ============================================================
-- BƯỚC 7: XÁC NHẬN — kiểm tra còn bảng acc_* nào không
-- ============================================================
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND (table_name LIKE 'acc_%' OR table_name IN ('einvoices', 'einvoice_lines'));

  IF v_count = 0 THEN
    RAISE NOTICE '✅ Xoá thành công — không còn bảng acc_* hay einvoice* nào.';
  ELSE
    RAISE WARNING '⚠️  Còn % bảng chưa xoá. Kiểm tra lại.', v_count;
  END IF;
END $$;
