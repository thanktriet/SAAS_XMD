// Script tạo tài khoản admin
// Chạy: node scripts/create-admin.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong file .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

// ===== CẤU HÌNH TÀI KHOẢN ADMIN =====
const ADMIN_EMAIL    = 'admin@erp.com';
const ADMIN_PASSWORD = 'Admin@123456';
const ADMIN_FULLNAME = 'Quản trị viên';
const ADMIN_PHONE    = '0900000000';
// =====================================

async function createAdmin() {
  console.log('🚀 Bắt đầu tạo tài khoản admin...\n');

  // Bước 1: Tạo user trong Supabase Auth
  console.log('📧 Tạo tài khoản xác thực...');
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true, // Xác nhận email luôn, không cần verify qua email
  });

  if (authError) {
    if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
      console.log('⚠️  Email này đã tồn tại trong Supabase Auth, tiếp tục kiểm tra bảng users...');
    } else {
      console.error('❌ Lỗi tạo auth user:', authError.message);
      process.exit(1);
    }
  } else {
    console.log('✅ Tạo auth user thành công:', authData.user.id);
  }

  // Bước 2: Lấy user ID từ Auth (dùng lại nếu đã tồn tại)
  const { data: { users: authUsers }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    console.error('❌ Không thể lấy danh sách users:', listError.message);
    process.exit(1);
  }

  const authUser = authUsers.find(u => u.email === ADMIN_EMAIL);
  if (!authUser) {
    console.error('❌ Không tìm thấy auth user sau khi tạo');
    process.exit(1);
  }

  // Bước 3: Kiểm tra xem đã có trong bảng users chưa
  console.log('\n👤 Kiểm tra bảng users...');
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id, email, role')
    .eq('email', ADMIN_EMAIL)
    .single();

  if (existingUser) {
    console.log('⚠️  Tài khoản đã tồn tại trong bảng users:');
    console.log('   ID   :', existingUser.id);
    console.log('   Email:', existingUser.email);
    console.log('   Role :', existingUser.role);

    // Cập nhật role thành admin nếu chưa phải
    if (existingUser.role !== 'admin') {
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ role: 'admin', is_active: true })
        .eq('email', ADMIN_EMAIL);

      if (updateError) {
        console.error('❌ Lỗi cập nhật role:', updateError.message);
      } else {
        console.log('✅ Đã cập nhật role thành admin');
      }
    }
  } else {
    // Bước 4: Thêm vào bảng users với role admin
    console.log('➕ Thêm vào bảng users...');
    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authUser.id, // Dùng cùng ID với Supabase Auth
        email: ADMIN_EMAIL,
        full_name: ADMIN_FULLNAME,
        phone: ADMIN_PHONE,
        role: 'admin',
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Lỗi thêm vào bảng users:', insertError.message);
      process.exit(1);
    }

    console.log('✅ Thêm vào bảng users thành công:', newUser.id);
  }

  console.log('\n========================================');
  console.log('🎉 Tài khoản admin đã sẵn sàng!');
  console.log('========================================');
  console.log('   Email   :', ADMIN_EMAIL);
  console.log('   Mật khẩu:', ADMIN_PASSWORD);
  console.log('   Vai trò :', 'admin');
  console.log('========================================\n');
}

createAdmin().catch(err => {
  console.error('❌ Lỗi không mong muốn:', err.message);
  process.exit(1);
});
