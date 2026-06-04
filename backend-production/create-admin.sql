-- ============================================================
-- Tạo tài khoản Admin
-- Chạy file này trong Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
  v_user_id   UUID;
  v_email     TEXT := 'admin@erp.com';
  v_password  TEXT := 'Admin@123456';
  v_full_name TEXT := 'Quản trị viên';
  v_phone     TEXT := '0900000000';
BEGIN

  -- Bước 1: Kiểm tra user đã tồn tại trong auth.users chưa
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email;

  IF v_user_id IS NULL THEN
    -- Tạo mới trong auth.users
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      role,
      aud,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    ) VALUES (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(v_password, gen_salt('bf')),
      NOW(),              -- email đã xác nhận luôn
      'authenticated',
      'authenticated',
      NOW(),
      NOW(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      FALSE,
      '', '', '', ''
    )
    RETURNING id INTO v_user_id;

    RAISE NOTICE '✅ Đã tạo auth user: %', v_user_id;
  ELSE
    RAISE NOTICE '⚠️  Auth user đã tồn tại: %', v_user_id;
  END IF;

  -- Bước 2: Kiểm tra user đã có trong bảng public.users chưa
  IF EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    -- Cập nhật role thành admin nếu chưa phải
    UPDATE public.users
    SET role = 'admin', is_active = TRUE, full_name = v_full_name
    WHERE email = v_email;
    RAISE NOTICE '⚠️  User đã tồn tại trong bảng users, đã cập nhật role = admin';
  ELSE
    -- Thêm mới vào bảng public.users
    INSERT INTO public.users (id, email, full_name, phone, role, is_active)
    VALUES (v_user_id, v_email, v_full_name, v_phone, 'admin', TRUE);
    RAISE NOTICE '✅ Đã thêm vào bảng users với role = admin';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '🎉 Tài khoản admin sẵn sàng!';
  RAISE NOTICE '   Email   : %', v_email;
  RAISE NOTICE '   Mật khẩu: %', v_password;
  RAISE NOTICE '   Vai trò : admin';
  RAISE NOTICE '========================================';

END $$;
