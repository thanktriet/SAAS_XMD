/**
 * Supabase-compatible adapter — drop-in replacement
 * Controllers vẫn import { supabaseAdmin } từ file này,
 * nhưng bên dưới chạy trên PostgreSQL local qua pg Pool.
 */
const { from, pool, QueryBuilder } = require('./queryBuilder');

// Bảng GLOBAL — không filter theo branch_id (không có cột branch_id hoặc là child table)
const GLOBAL_TABLES = [
  'vehicle_models', 'vehicle_model_colors',
  'acc_organizations', 'acc_branches', 'acc_accounts', 'acc_fiscal_periods',
  'acc_account_mappings', 'acc_integration_configs',
  'installment_providers',
  'branches', 'branch_license_logs', 'refresh_tokens', 'login_attempts',
  'license_plans',
  'v_monthly_revenue',
  // Child tables của sales_orders (không có branch_id riêng, dùng order_id đã filter)
  'sales_order_payments', 'sales_order_attachments',
  'sales_order_items', 'sales_order_accessories',
  'sales_order_promotions', 'sales_order_fees', 'sales_order_services',
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
 * - Super admin (admin/manager KHÔNG có branch_id): thấy tất cả
 * - Admin/manager chi nhánh (CÓ branch_id): chỉ thấy data chi nhánh mình
 * - Nhân viên: auto-inject branch_id vào mọi query
 */
function createBranchClient(branchId, role) {
  const isSuperAdmin = ['admin', 'manager'].includes(role) && !branchId;
  return {
    from(tableName) {
      const qb = new QueryBuilder(tableName);
      if (!isSuperAdmin && branchId && !GLOBAL_TABLES.includes(tableName)) {
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
