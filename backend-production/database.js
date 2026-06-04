const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'erp_xe_may_dien',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

pool.on('connect', () => {
  console.log('✅ Kết nối PostgreSQL thành công');
});

pool.on('error', (err) => {
  console.error('❌ Lỗi PostgreSQL:', err.message);
});

module.exports = pool;
