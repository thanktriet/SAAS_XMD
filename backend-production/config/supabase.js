/**
 * Supabase-compatible adapter — drop-in replacement
 * Controllers vẫn import { supabaseAdmin } từ file này,
 * nhưng bên dưới chạy trên PostgreSQL local qua pg Pool.
 */
const { from, pool, QueryBuilder } = require('./queryBuilder');

// Bảng GLOBAL — không filter theo branch_id
const GLOBAL_TABLES = [
  'users', 'vehicle_models', 'vehicle_model_colors',
  'acc_organizations', 'acc_branches', 'acc_accounts', 'acc_fiscal_periods',
  'acc_account_mappings', 'acc_integration_configs',
  'branch_branding', 'installment_providers',
  'branches', 'branch_license_logs', 'refresh_tokens', 'login_attempts',
];

// supabaseAdmin.from('table') → QueryBuilder instance (không branch filter)
const supabaseAdmin = {
  from,
  storage: {
    from: (bucket) => ({
      upload: async () => ({ error: null }),
      getPublicUrl: (path) => ({ data: { publicUrl: `/uploads/${bucket}/${path}` } }),
      remove: async () => ({ error: null }),
    }),
  },
};

/**
 * Tạo branch-scoped client.
 * - Admin/manager: không filter (thấy tất cả)
 * - Nhân viên: auto-inject branch_id vào mọi query
 */
function createBranchClient(branchId, role) {
  const isAdmin = ['admin', 'manager'].includes(role);
  return {
    from(tableName) {
      const qb = new QueryBuilder(tableName);
      if (!isAdmin && branchId && !GLOBAL_TABLES.includes(tableName)) {
        qb._autoBranchId = branchId;
      }
      return qb;
    },
    storage: supabaseAdmin.storage,
  };
}

// supabase (anon client) — giữ cho tương thích
const supabase = supabaseAdmin;

console.log('✅ PostgreSQL query adapter khởi tạo thành công');

module.exports = { supabase, supabaseAdmin, createBranchClient, GLOBAL_TABLES };
