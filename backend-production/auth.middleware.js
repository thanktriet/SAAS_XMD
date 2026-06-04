const { supabaseAdmin, createBranchClient } = require('./config/supabase');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'xmd-saas-local-secret-key-2024';

/**
 * Xác thực JWT token.
 * Gắn req.user: sub (users.id), email, role, branch_id.
 * Gắn req.db: branch-scoped query client.
 * Check license chi nhánh — nếu hết hạn/bị dừng → 403.
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Không có token xác thực', code: 'NO_TOKEN' });
  }
  const token = authHeader.split(' ')[1];
  try {
    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);

    // Lookup user trong DB để đảm bảo vẫn active
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, email, role, is_active, branch_id')
      .eq('id', decoded.sub)
      .maybeSingle();

    if (!profile) {
      return res.status(403).json({ error: 'Tài khoản không tồn tại trong hệ thống', code: 'USER_NOT_FOUND' });
    }

    if (!profile.is_active) {
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa', code: 'ACCOUNT_DISABLED' });
    }

    // === LICENSE CHECK ===
    // Admin không cần check license (admin là người quản lý hệ thống)
    if (profile.role !== 'admin' && profile.branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('branches')
        .select('id, name, is_active, license_end')
        .eq('id', profile.branch_id)
        .maybeSingle();

      if (branch) {
        // Chi nhánh bị dừng
        if (!branch.is_active) {
          return res.status(403).json({
            error: `Chi nhánh "${branch.name}" đã bị tạm dừng. Liên hệ quản trị viên.`,
            code: 'BRANCH_SUSPENDED',
          });
        }

        // License hết hạn
        if (branch.license_end && new Date(branch.license_end) < new Date()) {
          return res.status(403).json({
            error: `Quyền sử dụng của chi nhánh "${branch.name}" đã hết hạn.`,
            code: 'LICENSE_EXPIRED',
          });
        }
      }
    }

    req.user = {
      sub:       profile.id,
      email:     profile.email,
      role:      profile.role,
      branch_id: profile.branch_id,
    };

    // Attach branch-scoped DB client
    req.db = createBranchClient(profile.branch_id, profile.role);

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token đã hết hạn', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token không hợp lệ', code: 'TOKEN_INVALID' });
  }
};

/**
 * Phân quyền theo role.
 */
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập', code: 'FORBIDDEN' });
  }
  next();
};

module.exports = { authenticate, authorize };
