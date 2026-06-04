-- MIGRATION: fix_sales_orders_status_constraint

ALTER TABLE sales_orders
  DROP CONSTRAINT sales_orders_status_check,
  ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN (
      'draft',
      'confirmed',
      'deposit_paid',
      'full_paid',
      'invoice_requested',
      'invoice_approved',
      'pdi_pending',
      'pdi_done',
      'delivered',
      'cancelled'
    ));
