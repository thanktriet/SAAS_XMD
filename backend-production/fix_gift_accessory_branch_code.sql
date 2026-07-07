-- Fix: mã quà tặng / phụ kiện chưa gán mã chi nhánh
-- Nguyên nhân: trigger active gọi fn_gen_gift_code / fn_gen_accessory_code (dạng cũ
-- QT00001 / PK00001, không branch). Migration branch-code trước đó lại định nghĩa hàm
-- KHÁC TÊN (generate_gift_code / generate_accessory_code) nên không có tác dụng.
-- Sửa: cập nhật chính 2 hàm đang được trigger gọi để thêm branch code.
-- Format: CN01-QT2026070001

CREATE OR REPLACE FUNCTION public.fn_gen_gift_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_branch_code TEXT;
  v_prefix TEXT;
  v_count INTEGER;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    SELECT REPLACE(branch_code, '-', '') INTO v_branch_code
    FROM acc_branches WHERE id = NEW.branch_id;
    v_branch_code := COALESCE(v_branch_code, 'HQ');

    v_prefix := v_branch_code || '-QT' || TO_CHAR(NOW(), 'YYYYMM');
    SELECT COUNT(*) + 1 INTO v_count
      FROM gift_items WHERE code LIKE v_prefix || '%';
    NEW.code := v_prefix || LPAD(v_count::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_gen_accessory_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_branch_code TEXT;
  v_prefix TEXT;
  v_count INTEGER;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    SELECT REPLACE(branch_code, '-', '') INTO v_branch_code
    FROM acc_branches WHERE id = NEW.branch_id;
    v_branch_code := COALESCE(v_branch_code, 'HQ');

    v_prefix := v_branch_code || '-PK' || TO_CHAR(NOW(), 'YYYYMM');
    SELECT COUNT(*) + 1 INTO v_count
      FROM accessories WHERE code LIKE v_prefix || '%';
    NEW.code := v_prefix || LPAD(v_count::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
