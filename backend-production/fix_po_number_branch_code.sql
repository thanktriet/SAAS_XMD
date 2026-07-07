-- Fix: mã đơn nhập (po_number) chưa gán mã chi nhánh
-- Trigger generate_po_number sinh 'NK202600001' — thiếu branch prefix.
-- Sửa: thêm branch code phía trước → 'CN01-NK202600001'

CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_branch_code TEXT;
  v_year   TEXT;
  v_prefix TEXT;
  v_seq    INTEGER;
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    SELECT REPLACE(branch_code, '-', '') INTO v_branch_code
    FROM acc_branches WHERE id = NEW.branch_id;
    v_branch_code := COALESCE(v_branch_code, 'HQ');

    v_year   := TO_CHAR(NOW(), 'YYYY');
    v_prefix := v_branch_code || '-NK' || v_year;
    SELECT COUNT(*) + 1 INTO v_seq
    FROM purchase_orders
    WHERE po_number LIKE v_prefix || '%';
    NEW.po_number := v_prefix || LPAD(v_seq::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;
