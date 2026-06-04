const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env');
  process.exit(1);
}

// Client admin (dùng service role key - chỉ dùng phía backend)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

// Client thường (dùng anon key)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log('✅ Supabase client khởi tạo thành công');

module.exports = { supabase, supabaseAdmin };
