const { supabaseAdmin } = require('./config/supabase');

// Cache branch_code theo branch_id (trong RAM, reset khi restart server)
const _branchCache = new Map();

/**
 * Lấy branch_code từ branch_id. Trả về mã ngắn (vd: "HQ001", "HCM01")
 * Dùng để prefix tất cả mã tự sinh: đơn hàng, khách hàng, phiếu DV, v.v.
 *
 * Nếu không có branch_id (super admin) → trả "HQ"
 */
async function getBranchCode(req) {
  const branchId = req.user?.branch_id;
  if (!branchId) return 'HQ';

  if (_branchCache.has(branchId)) return _branchCache.get(branchId);

  const { data } = await supabaseAdmin.from('acc_branches')
    .select('branch_code')
    .eq('id', branchId)
    .single();

  // Lấy phần ngắn: "HQ-001" → "HQ001", "HCM-01" → "HCM01"
  const code = (data?.branch_code || 'HQ').replace(/-/g, '');
  _branchCache.set(branchId, code);
  return code;
}

/**
 * Sinh mã có prefix chi nhánh.
 * generateCode(req, { table, column, prefix, padLength, yearInPrefix })
 *
 * Ví dụ:
 *   generateCode(req, { table: 'sales_orders', column: 'order_number', prefix: 'DH', padLength: 5, yearInPrefix: true })
 *   → "HQ001-DH202600001"
 *
 *   generateCode(req, { table: 'customers', column: 'customer_code', prefix: 'KH', padLength: 6, yearInPrefix: false })
 *   → "HQ001-KH000001"
 */
async function generateCode(req, { table, column, prefix, padLength = 5, yearInPrefix = false }) {
  const branchCode = await getBranchCode(req);
  const year = new Date().getFullYear();
  const codePrefix = yearInPrefix ? `${prefix}${year}` : prefix;
  const fullPrefix = `${branchCode}-${codePrefix}`;

  // Tìm mã lớn nhất có cùng prefix
  const db = req.db || supabaseAdmin;
  const { data: last } = await db.from(table)
    .select(column)
    .like(column, `${fullPrefix}%`)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextNum = 1;
  if (last?.[column]) {
    const numStr = last[column].replace(fullPrefix, '');
    const num = parseInt(numStr, 10);
    if (!isNaN(num)) nextNum = num + 1;
  }

  return `${fullPrefix}${String(nextNum).padStart(padLength, '0')}`;
}

module.exports = { getBranchCode, generateCode };
