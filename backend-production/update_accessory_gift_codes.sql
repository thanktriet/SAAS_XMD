-- Update triggers to include branch_code in accessory and gift codes

-- Accessory code: BD001-PK2026060001
CREATE OR REPLACE FUNCTION generate_accessory_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_branch_code TEXT;
  v_prefix TEXT;
  v_count INTEGER;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    -- Get branch code
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

-- Gift code: BD001-QT2026060001
CREATE OR REPLACE FUNCTION generate_gift_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_branch_code TEXT;
  v_prefix TEXT;
  v_count INTEGER;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    -- Get branch code
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
