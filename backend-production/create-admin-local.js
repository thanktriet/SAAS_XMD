/**
 * Tạo admin user cho local PostgreSQL
 * Chạy: node create-admin-local.js
 */
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'erp_xe_may_dien',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function createAdmin() {
  const email = 'admin@xmd.vn';
  const password = 'admin123';
  const full_name = 'Admin XMD';
  const role = 'admin';

  try {
    // Check if admin already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log('⚠️  Admin user đã tồn tại:', email);
      process.exit(0);
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, email, full_name, role`,
      [email, password_hash, full_name, role]
    );

    console.log('✅ Tạo admin thành công:');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('   Role:', role);
    console.log('   ID:', result.rows[0].id);
  } catch (err) {
    console.error('❌ Lỗi:', err.message);
  } finally {
    await pool.end();
  }
}

createAdmin();
