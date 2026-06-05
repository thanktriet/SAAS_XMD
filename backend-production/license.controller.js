const { supabaseAdmin } = require('./config/supabase');
const { revokeAllBranchTokens } = require('./auth.controller');

// ─── BRANCHES CRUD ───────────────────────────────────────────────────────────

// Danh sách chi nhánh (kèm thông tin license)
const getBranches = async (req, res) => {
  try {
    const { search, is_active } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    let q = supabaseAdmin
      .from('branches')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true');

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    // Đếm số user mỗi chi nhánh
    const branchIds = (data || []).map(b => b.id);
    let userCounts = {};
    if (branchIds.length > 0) {
      const { data: counts } = await supabaseAdmin
        .from('users')
        .select('branch_id')
        .in('branch_id', branchIds)
        .eq('is_active', true);

      if (counts) {
        counts.forEach(u => {
          userCounts[u.branch_id] = (userCounts[u.branch_id] || 0) + 1;
        });
      }
    }

    const enriched = (data || []).map(b => ({
      ...b,
      current_users: userCounts[b.id] || 0,
      is_expired: b.license_end ? new Date(b.license_end) < new Date() : false,
      days_remaining: b.license_end
        ? Math.ceil((new Date(b.license_end) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    }));

    res.json({ data: enriched, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết 1 chi nhánh
const getBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: branch, error } = await supabaseAdmin
      .from('branches')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });

    // Đếm users
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, role, is_active')
      .eq('branch_id', id);

    // Lịch sử license
    const { data: logs } = await supabaseAdmin
      .from('branch_license_logs')
      .select('*')
      .eq('branch_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({
      ...branch,
      current_users: (users || []).filter(u => u.is_active).length,
      users: users || [],
      license_logs: logs || [],
      is_expired: branch.license_end ? new Date(branch.license_end) < new Date() : false,
      days_remaining: branch.license_end
        ? Math.ceil((new Date(branch.license_end) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo chi nhánh mới
const createBranch = async (req, res) => {
  try {
    const { code, name, address, phone, email, license_days, license_plan, max_users } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'Mã chi nhánh và tên chi nhánh là bắt buộc' });
    }

    // Check mã trùng
    const { data: existing } = await supabaseAdmin
      .from('branches')
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: `Mã chi nhánh "${code}" đã tồn tại` });
    }

    const now = new Date();
    const licenseEnd = license_days
      ? new Date(now.getTime() + license_days * 24 * 60 * 60 * 1000)
      : null;

    const { data: branch, error } = await supabaseAdmin
      .from('branches')
      .insert([{
        code,
        name,
        address: address || null,
        phone: phone || null,
        email: email || null,
        is_active: true,
        license_start: now.toISOString(),
        license_end: licenseEnd ? licenseEnd.toISOString() : null,
        license_plan: license_plan || 'basic',
        max_users: max_users || 10,
        created_by: req.user.sub,
      }])
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Ghi log
    await supabaseAdmin
      .from('branch_license_logs')
      .insert([{
        branch_id: branch.id,
        action: 'activate',
        new_end: licenseEnd ? licenseEnd.toISOString() : null,
        new_plan: license_plan || 'basic',
        performed_by: req.user.sub,
        reason: 'Tạo chi nhánh mới',
        ip_address: req.ip || null,
      }]);

    res.status(201).json({ message: `Đã tạo chi nhánh "${name}"`, data: branch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật thông tin chi nhánh
const updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'address', 'phone', 'email', 'max_users', 'license_plan'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Không có trường nào được cập nhật' });
    }

    const { data, error } = await supabaseAdmin
      .from('branches')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật chi nhánh', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── LICENSE MANAGEMENT ──────────────────────────────────────────────────────

// Gia hạn license
const extendLicense = async (req, res) => {
  try {
    const { id } = req.params;
    const { days, reason } = req.body;

    if (!days || days < 1) {
      return res.status(400).json({ error: 'Số ngày gia hạn phải lớn hơn 0' });
    }

    const { data: branch, error: fetchErr } = await supabaseAdmin
      .from('branches')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });

    // Nếu đã hết hạn → gia hạn từ bây giờ
    // Nếu còn hạn → gia hạn thêm từ ngày hết hạn hiện tại
    const baseDate = (branch.license_end && new Date(branch.license_end) > new Date())
      ? new Date(branch.license_end)
      : new Date();

    const newEnd = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    const { data, error } = await supabaseAdmin
      .from('branches')
      .update({
        is_active: true,
        license_end: newEnd.toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Ghi log
    await supabaseAdmin
      .from('branch_license_logs')
      .insert([{
        branch_id: id,
        action: 'extend',
        previous_end: branch.license_end,
        new_end: newEnd.toISOString(),
        performed_by: req.user.sub,
        reason: reason || `Gia hạn thêm ${days} ngày`,
        ip_address: req.ip || null,
      }]);

    res.json({
      message: `Đã gia hạn chi nhánh "${branch.name}" thêm ${days} ngày (đến ${newEnd.toLocaleDateString('vi-VN')})`,
      data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạm dừng chi nhánh (suspend) — đá tất cả user ra ngay
const suspendBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: branch, error: fetchErr } = await supabaseAdmin
      .from('branches')
      .select('name, is_active')
      .eq('id', id)
      .single();

    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });

    if (!branch.is_active) {
      return res.status(400).json({ error: 'Chi nhánh đã bị dừng trước đó' });
    }

    // Khóa chi nhánh
    const { error } = await supabaseAdmin
      .from('branches')
      .update({ is_active: false })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    // REVOKE tất cả refresh token của chi nhánh → đá user ra ngay
    await revokeAllBranchTokens(id);

    // Ghi log
    await supabaseAdmin
      .from('branch_license_logs')
      .insert([{
        branch_id: id,
        action: 'suspend',
        performed_by: req.user.sub,
        reason: reason || 'Admin tạm dừng chi nhánh',
        ip_address: req.ip || null,
      }]);

    res.json({ message: `Đã tạm dừng chi nhánh "${branch.name}". Tất cả nhân viên sẽ bị đăng xuất.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Kích hoạt lại chi nhánh (chưa gia hạn — giữ nguyên license_end)
const activateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: branch, error: fetchErr } = await supabaseAdmin
      .from('branches')
      .select('name, is_active, license_end')
      .eq('id', id)
      .single();

    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });

    if (branch.is_active) {
      return res.status(400).json({ error: 'Chi nhánh đang hoạt động' });
    }

    // Cảnh báo nếu license đã hết hạn
    const isExpired = branch.license_end && new Date(branch.license_end) < new Date();

    const { error } = await supabaseAdmin
      .from('branches')
      .update({ is_active: true })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    // Ghi log
    await supabaseAdmin
      .from('branch_license_logs')
      .insert([{
        branch_id: id,
        action: 'activate',
        performed_by: req.user.sub,
        reason: reason || 'Admin kích hoạt lại chi nhánh',
        ip_address: req.ip || null,
      }]);

    let message = `Đã kích hoạt lại chi nhánh "${branch.name}".`;
    if (isExpired) {
      message += ' ⚠️ Lưu ý: License đã hết hạn, vui lòng gia hạn.';
    }

    res.json({ message, warning: isExpired ? 'LICENSE_EXPIRED' : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Thu hồi vĩnh viễn (revoke) — khóa cứng, không kích hoạt lại được qua activate
const revokeBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: branch, error: fetchErr } = await supabaseAdmin
      .from('branches')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });

    // Khóa chi nhánh + xóa license
    const { error } = await supabaseAdmin
      .from('branches')
      .update({ is_active: false, license_end: null, license_start: null })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    // Revoke tokens
    await revokeAllBranchTokens(id);

    // Vô hiệu hóa tất cả user của chi nhánh
    await supabaseAdmin
      .from('users')
      .update({ is_active: false })
      .eq('branch_id', id);

    // Ghi log
    await supabaseAdmin
      .from('branch_license_logs')
      .insert([{
        branch_id: id,
        action: 'revoke',
        performed_by: req.user.sub,
        reason: reason || 'Admin thu hồi quyền sử dụng',
        ip_address: req.ip || null,
      }]);

    res.json({ message: `Đã thu hồi quyền sử dụng chi nhánh "${branch.name}". Tất cả tài khoản đã bị vô hiệu hóa.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Lịch sử thao tác license (toàn hệ thống)
const getLicenseLogs = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    let q = supabaseAdmin
      .from('branch_license_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (branch_id) q = q.eq('branch_id', branch_id);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Dashboard tổng quan license
const getLicenseDashboard = async (req, res) => {
  try {
    const { data: branches } = await supabaseAdmin
      .from('branches')
      .select('id, name, code, is_active, license_end, license_plan, max_users');

    const now = new Date();
    const stats = {
      total: (branches || []).length,
      active: 0,
      suspended: 0,
      expired: 0,
      expiring_soon: 0, // hết hạn trong 7 ngày tới
      branches: [],
    };

    (branches || []).forEach(b => {
      const isExpired = b.license_end && new Date(b.license_end) < now;
      const daysLeft = b.license_end
        ? Math.ceil((new Date(b.license_end) - now) / (1000 * 60 * 60 * 24))
        : null;

      if (!b.is_active) {
        stats.suspended++;
      } else if (isExpired) {
        stats.expired++;
      } else {
        stats.active++;
        if (daysLeft !== null && daysLeft <= 7) {
          stats.expiring_soon++;
        }
      }

      stats.branches.push({
        ...b,
        is_expired: isExpired,
        days_remaining: daysLeft,
        status: !b.is_active ? 'suspended' : isExpired ? 'expired' : 'active',
      });
    });

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Danh sách gói license
const getPlans = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('license_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Đổi gói license cho chi nhánh
const changePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { plan, reason } = req.body;

    if (!plan) {
      return res.status(400).json({ error: 'Vui lòng chọn gói' });
    }

    // Kiểm tra gói hợp lệ
    const { data: planData } = await supabaseAdmin
      .from('license_plans')
      .select('*')
      .eq('id', plan)
      .maybeSingle();

    if (!planData) {
      return res.status(400).json({ error: 'Gói không tồn tại' });
    }

    const { data: branch, error: fetchErr } = await supabaseAdmin
      .from('branches')
      .select('name, license_plan, max_users')
      .eq('id', id)
      .single();

    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy chi nhánh' });

    const previousPlan = branch.license_plan;

    const { error } = await supabaseAdmin
      .from('branches')
      .update({ license_plan: plan, max_users: planData.max_users })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    // Ghi log
    await supabaseAdmin
      .from('branch_license_logs')
      .insert([{
        branch_id: id,
        action: 'plan_change',
        previous_plan: previousPlan,
        new_plan: plan,
        performed_by: req.user.sub,
        reason: reason || `Đổi gói từ ${previousPlan} sang ${plan}`,
        ip_address: req.ip || null,
      }]);

    res.json({
      message: `Đã đổi gói chi nhánh "${branch.name}" sang ${planData.name} (max ${planData.max_users} users)`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getBranches,
  getBranch,
  createBranch,
  updateBranch,
  extendLicense,
  suspendBranch,
  activateBranch,
  revokeBranch,
  getLicenseLogs,
  getLicenseDashboard,
  getPlans,
  changePlan,
};
