const { supabaseAdmin } = require('./config/supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'xmd-saas-local-secret-key-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';          // Rút ngắn xuống 15 phút
const REFRESH_EXPIRES_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS) || 7;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  const payload = { sub: user.id, email: user.email, role: user.role, branch_id: user.branch_id };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const decoded = jwt.decode(token);
  return { token, expiresAt: decoded.exp * 1000 };
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Lưu refresh token vào DB
async function storeRefreshToken(userId, branchId, refreshToken, req) {
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  const tokenHash = hashToken(refreshToken);
  const deviceInfo = req.headers['user-agent'] || null;
  const ipAddress = req.ip || req.connection?.remoteAddress || null;

  await supabaseAdmin
    .from('refresh_tokens')
    .insert([{
      user_id: userId,
      branch_id: branchId || null,
      token_hash: tokenHash,
      device_info: deviceInfo,
      ip_address: ipAddress,
      is_revoked: false,
      expires_at: expiresAt.toISOString(),
    }]);

  return { expiresAt };
}

// Revoke tất cả refresh token của một user
async function revokeAllUserTokens(userId) {
  await supabaseAdmin
    .from('refresh_tokens')
    .update({ is_revoked: true })
    .eq('user_id', userId)
    .eq('is_revoked', false);
}

// Revoke tất cả refresh token của một chi nhánh
async function revokeAllBranchTokens(branchId) {
  await supabaseAdmin
    .from('refresh_tokens')
    .update({ is_revoked: true })
    .eq('branch_id', branchId)
    .eq('is_revoked', false);
}

// ─── Rate Limiting (DB-based) ────────────────────────────────────────────────

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_MINUTES = parseInt(process.env.LOCKOUT_MINUTES) || 15;

async function checkRateLimit(email, ip) {
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();

  // Đếm số lần login thất bại gần đây
  const { data: attempts } = await supabaseAdmin
    .from('login_attempts')
    .select('id')
    .eq('email', email)
    .eq('success', false)
    .gte('created_at', since);

  if (attempts && attempts.length >= MAX_LOGIN_ATTEMPTS) {
    return {
      locked: true,
      message: `Tài khoản bị khóa tạm thời do đăng nhập sai quá ${MAX_LOGIN_ATTEMPTS} lần. Vui lòng thử lại sau ${LOCKOUT_MINUTES} phút.`,
      remainingMinutes: LOCKOUT_MINUTES,
    };
  }

  // Check IP-based rate limit (30 attempts per IP)
  const { data: ipAttempts } = await supabaseAdmin
    .from('login_attempts')
    .select('id')
    .eq('ip_address', ip)
    .eq('success', false)
    .gte('created_at', since);

  if (ipAttempts && ipAttempts.length >= 30) {
    return {
      locked: true,
      message: 'Quá nhiều yêu cầu từ địa chỉ IP này. Vui lòng thử lại sau.',
      remainingMinutes: LOCKOUT_MINUTES,
    };
  }

  return { locked: false };
}

async function recordLoginAttempt(email, ip, success, failureReason, userAgent) {
  await supabaseAdmin
    .from('login_attempts')
    .insert([{
      email,
      ip_address: ip || null,
      success,
      failure_reason: failureReason || null,
      user_agent: userAgent || null,
    }]);
}

// ─── Auth Controllers ────────────────────────────────────────────────────────

// Đăng nhập
const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu' });
  }

  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    // Rate limit check
    const rateLimit = await checkRateLimit(email, ip);
    if (rateLimit.locked) {
      return res.status(429).json({
        error: rateLimit.message,
        code: 'RATE_LIMITED',
        retryAfter: rateLimit.remainingMinutes * 60,
      });
    }

    // Lấy user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .ilike('email', email)
      .maybeSingle();

    if (!user) {
      await recordLoginAttempt(email, ip, false, 'user_not_found', userAgent);
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    }

    if (!user.is_active) {
      await recordLoginAttempt(email, ip, false, 'account_disabled', userAgent);
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa', code: 'ACCOUNT_DISABLED' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await recordLoginAttempt(email, ip, false, 'wrong_password', userAgent);
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    }

    // === LICENSE CHECK ===
    // Admin không cần check license
    if (user.role !== 'admin' && user.branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('branches')
        .select('id, name, is_active, license_end')
        .eq('id', user.branch_id)
        .maybeSingle();

      if (branch) {
        if (!branch.is_active) {
          await recordLoginAttempt(email, ip, false, 'branch_suspended', userAgent);
          return res.status(403).json({
            error: `Chi nhánh "${branch.name}" đã bị tạm dừng. Liên hệ quản trị viên.`,
            code: 'BRANCH_SUSPENDED',
          });
        }

        if (branch.license_end && new Date(branch.license_end) < new Date()) {
          // Tự động khóa chi nhánh
          await supabaseAdmin
            .from('branches')
            .update({ is_active: false })
            .eq('id', branch.id);

          // Revoke tất cả token chi nhánh
          await revokeAllBranchTokens(branch.id);

          await recordLoginAttempt(email, ip, false, 'license_expired', userAgent);
          return res.status(403).json({
            error: `Quyền sử dụng của chi nhánh "${branch.name}" đã hết hạn.`,
            code: 'LICENSE_EXPIRED',
          });
        }
      }
    }

    // Generate tokens
    const { token, expiresAt } = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, user.branch_id, refreshToken, req);

    // Record success
    await recordLoginAttempt(email, ip, true, null, userAgent);

    res.json({
      message: 'Đăng nhập thành công',
      token,
      refreshToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        branch_id: user.branch_id,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Làm mới access token — TOKEN ROTATION (mỗi lần refresh tạo token mới, revoke cũ)
const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Thiếu refresh token' });
  }

  try {
    const tokenHash = hashToken(refreshToken);

    // Tìm token trong DB
    const { data: storedToken } = await supabaseAdmin
      .from('refresh_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('is_revoked', false)
      .maybeSingle();

    if (!storedToken) {
      return res.status(401).json({ error: 'Refresh token không hợp lệ hoặc đã bị thu hồi', code: 'TOKEN_REVOKED' });
    }

    // Check hết hạn
    if (new Date(storedToken.expires_at) < new Date()) {
      // Revoke token hết hạn
      await supabaseAdmin
        .from('refresh_tokens')
        .update({ is_revoked: true })
        .eq('id', storedToken.id);
      return res.status(401).json({ error: 'Refresh token đã hết hạn, vui lòng đăng nhập lại', code: 'TOKEN_EXPIRED' });
    }

    // Lấy user hiện tại
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, role, is_active, branch_id')
      .eq('id', storedToken.user_id)
      .maybeSingle();

    if (!user || !user.is_active) {
      await supabaseAdmin
        .from('refresh_tokens')
        .update({ is_revoked: true })
        .eq('id', storedToken.id);
      return res.status(401).json({ error: 'Tài khoản không hợp lệ hoặc đã bị vô hiệu hóa', code: 'ACCOUNT_DISABLED' });
    }

    // === LICENSE CHECK on refresh ===
    if (user.role !== 'admin' && user.branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('branches')
        .select('id, is_active, license_end')
        .eq('id', user.branch_id)
        .maybeSingle();

      if (branch && (!branch.is_active || (branch.license_end && new Date(branch.license_end) < new Date()))) {
        // Revoke token + block
        await revokeAllBranchTokens(branch.id);
        return res.status(403).json({
          error: 'Chi nhánh đã hết hạn hoặc bị tạm dừng.',
          code: 'BRANCH_SUSPENDED',
        });
      }
    }

    // TOKEN ROTATION: revoke token cũ, tạo mới
    await supabaseAdmin
      .from('refresh_tokens')
      .update({ is_revoked: true })
      .eq('id', storedToken.id);

    // Generate new tokens
    const { token, expiresAt } = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, user.branch_id, newRefreshToken, req);

    res.json({
      token,
      refreshToken: newRefreshToken,
      expiresAt,
    });
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token không hợp lệ' });
  }
};

// Đăng xuất — revoke refresh token
const logout = async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await supabaseAdmin
      .from('refresh_tokens')
      .update({ is_revoked: true })
      .eq('token_hash', tokenHash);
  }

  // Optionally: revoke ALL tokens của user này
  // await revokeAllUserTokens(req.user.sub);

  res.json({ message: 'Đăng xuất thành công' });
};

// Lấy thông tin user hiện tại
const getMe = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, phone, role, is_active, avatar_url, branch_id, created_at')
      .eq('id', req.user.sub)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy user' });

    // Thêm thông tin license chi nhánh
    let branchInfo = null;
    if (data.branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('branches')
        .select('id, code, name, is_active, license_end, license_plan')
        .eq('id', data.branch_id)
        .maybeSingle();
      branchInfo = branch;
    }

    res.json({ ...data, branch: branchInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Quản lý người dùng (chỉ admin/manager) ──────────────────────────────────

const getUsers = async (req, res) => {
  try {
    const { search, role, is_active, branch_id } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const isSuperAdmin = req.user.role === 'admin' && !req.user.branch_id;

    let q = supabaseAdmin
      .from('users')
      .select('id, email, full_name, phone, role, is_active, avatar_url, branch_id, created_at', { count: 'exact' })
      .order('full_name');

    // Admin chi nhánh chỉ thấy user của chi nhánh mình
    if (!isSuperAdmin && req.user.branch_id) {
      q = q.eq('branch_id', req.user.branch_id);
    } else if (branch_id) {
      q = q.eq('branch_id', branch_id);
    }

    if (search)    q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    if (role)      q = q.eq('role', role);
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true');

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createUser = async (req, res) => {
  const { email, password, full_name, phone, role, branch_id } = req.body;
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc: email, password, full_name, role' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  try {
    const isSuperAdmin = req.user.role === 'admin' && !req.user.branch_id;
    const emailLower = email.trim().toLowerCase();

    // Admin chi nhánh: bắt buộc tạo user vào chi nhánh mình, không cho đặt branch_id khác
    const targetBranchId = isSuperAdmin
      ? (branch_id || null)
      : req.user.branch_id;

    // Admin chi nhánh không được tạo role admin
    if (!isSuperAdmin && role === 'admin') {
      return res.status(403).json({ error: 'Bạn không có quyền tạo tài khoản admin' });
    }

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', emailLower)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ error: 'Email đã tồn tại trong hệ thống' });
    }

    const password_hash = await bcrypt.hash(password, 12); // Tăng cost factor lên 12

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('users')
      .insert([{ email: emailLower, password_hash, full_name, phone: phone || null, role, branch_id: targetBranchId, is_active: true }])
      .select('id, email, full_name, phone, role, is_active, branch_id, created_at')
      .single();

    if (profileErr) {
      return res.status(400).json({ error: profileErr.message });
    }

    res.status(201).json({ message: `Đã tạo tài khoản ${full_name}`, data: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const isSuperAdmin = req.user.role === 'admin' && !req.user.branch_id;

    // Admin chi nhánh không được sửa branch_id và chỉ sửa user chi nhánh mình
    if (!isSuperAdmin && req.user.branch_id) {
      const { data: target } = await supabaseAdmin.from('users').select('branch_id').eq('id', id).maybeSingle();
      if (!target || target.branch_id !== req.user.branch_id) {
        return res.status(403).json({ error: 'Bạn chỉ có thể sửa nhân viên trong chi nhánh mình' });
      }
    }

    const allowed = isSuperAdmin
      ? ['full_name', 'phone', 'role', 'avatar_url', 'branch_id']
      : ['full_name', 'phone', 'role', 'avatar_url']; // admin chi nhánh không được đổi branch_id
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (!Object.keys(updates).length)
      return res.status(400).json({ error: 'Không có trường nào được cập nhật' });

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, email, full_name, phone, role, is_active, avatar_url, branch_id')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật thông tin', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const toggleUser = async (req, res) => {
  try {
    const { id } = req.params;
    const isSuperAdmin = req.user.role === 'admin' && !req.user.branch_id;

    if (req.user.sub === id || req.user.id === id)
      return res.status(409).json({ error: 'Không thể vô hiệu hóa tài khoản đang đăng nhập' });

    const { data: cur, error: fetchErr } = await supabaseAdmin
      .from('users').select('is_active, full_name, branch_id').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

    // Admin chi nhánh chỉ toggle user chi nhánh mình
    if (!isSuperAdmin && req.user.branch_id && cur.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Bạn chỉ có thể quản lý nhân viên trong chi nhánh mình' });
    }

    const newActive = !cur.is_active;
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ is_active: newActive })
      .eq('id', id)
      .select('id, email, full_name, role, is_active')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Nếu vô hiệu hóa → revoke tất cả token
    if (!newActive) {
      await revokeAllUserTokens(id);
    }

    const action = data.is_active ? 'kích hoạt' : 'vô hiệu hóa';
    res.json({ message: `Đã ${action} tài khoản ${cur.full_name}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const isSuperAdmin = req.user.role === 'admin' && !req.user.branch_id;

    if (!password || password.length < 6)
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });

    const { data: target, error: fetchErr } = await supabaseAdmin
      .from('users').select('full_name, branch_id').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

    // Admin chi nhánh chỉ đổi pass user chi nhánh mình
    if (!isSuperAdmin && req.user.branch_id && target.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Bạn chỉ có thể đổi mật khẩu nhân viên trong chi nhánh mình' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { error } = await supabaseAdmin
      .from('users')
      .update({ password_hash })
      .eq('id', id)
      .select('id')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Đổi password → revoke tất cả token (buộc đăng nhập lại)
    await revokeAllUserTokens(id);

    res.json({ message: `Đã đổi mật khẩu cho ${target.full_name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const changeMyPassword = async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password) return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại' });
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    if (old_password === new_password)
      return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu cũ' });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, password_hash')
      .eq('id', req.user.sub)
      .single();

    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    const isValid = await bcrypt.compare(old_password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    }

    const password_hash = await bcrypt.hash(new_password, 12);
    const { error } = await supabaseAdmin
      .from('users')
      .update({ password_hash })
      .eq('id', req.user.sub)
      .select('id')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Revoke tất cả token khác (giữ session hiện tại nếu muốn — ở đây revoke hết để buộc login lại)
    await revokeAllUserTokens(req.user.sub);

    res.json({ message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  login, refresh, logout, getMe,
  getUsers, createUser, updateUser, toggleUser, changePassword, changeMyPassword,
  // Export helpers for license controller
  revokeAllBranchTokens, revokeAllUserTokens,
};
