const { supabaseAdmin } = require('./config/supabase');

// GET /api/branding — trả branding cho branch của user hiện tại
const getBranding = async (req, res) => {
  try {
    const branchId = req.user.branch_id;
    if (!branchId) {
      return res.json({ store_name: 'XMĐ', subtitle: 'Hệ Thống Bán Hàng Xe Máy Điện' });
    }

    const { data, error } = await supabaseAdmin
      .from('branch_branding')
      .select('*')
      .eq('branch_id', branchId)
      .maybeSingle();

    if (!data) {
      // Fallback: lấy tên branch
      const { data: branch } = await supabaseAdmin
        .from('acc_branches')
        .select('branch_name, address, phone, email')
        .eq('id', branchId)
        .maybeSingle();
      return res.json({
        store_name: branch?.branch_name || 'XMĐ',
        subtitle: 'Hệ Thống Bán Hàng Xe Máy Điện',
        address: branch?.address,
        phone: branch?.phone,
        email: branch?.email,
      });
    }

    // Merge branch info
    const { data: branch } = await supabaseAdmin
      .from('acc_branches')
      .select('branch_name, address, phone, email')
      .eq('id', branchId)
      .maybeSingle();

    res.json({
      ...data,
      branch_name: branch?.branch_name,
      address: branch?.address || null,
      phone: data.hotline || branch?.phone || null,
      email: data.support_email || branch?.email || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/branding — cập nhật branding (admin only)
const updateBranding = async (req, res) => {
  try {
    const branchId = req.body.branch_id || req.user.branch_id;
    if (!branchId) {
      return res.status(400).json({ error: 'Thiếu branch_id' });
    }

    const allowed = [
      'store_name', 'subtitle', 'logo_url', 'favicon_url',
      'color_primary', 'color_primary_dark', 'color_primary_light', 'color_accent',
      'hotline', 'support_email', 'website_url', 'receipt_footer',
    ];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Không có trường nào được cập nhật' });
    }

    // Upsert
    const { data: existing } = await supabaseAdmin
      .from('branch_branding')
      .select('id')
      .eq('branch_id', branchId)
      .maybeSingle();

    let data;
    if (existing) {
      const result = await supabaseAdmin
        .from('branch_branding')
        .update(updates)
        .eq('branch_id', branchId)
        .select('*')
        .single();
      data = result.data;
      if (result.error) return res.status(400).json({ error: result.error.message });
    } else {
      const result = await supabaseAdmin
        .from('branch_branding')
        .insert([{ branch_id: branchId, store_name: updates.store_name || 'Cửa hàng', ...updates }])
        .select('*')
        .single();
      data = result.data;
      if (result.error) return res.status(400).json({ error: result.error.message });
    }

    res.json({ message: 'Đã cập nhật branding', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/branches — danh sách branches (admin)
const getBranches = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('acc_branches')
      .select('*')
      .order('branch_name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/branches — tạo branch mới (admin)
const createBranch = async (req, res) => {
  try {
    const { branch_code, branch_name, branch_type, address, phone, email, manager_id } = req.body;
    if (!branch_code || !branch_name) {
      return res.status(400).json({ error: 'Thiếu branch_code hoặc branch_name' });
    }

    // Lấy org_id mặc định
    const { data: org } = await supabaseAdmin
      .from('acc_organizations')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (!org) {
      return res.status(400).json({ error: 'Chưa có organization. Vui lòng tạo organization trước.' });
    }

    const { data, error } = await supabaseAdmin
      .from('acc_branches')
      .insert([{
        org_id: org.id,
        branch_code,
        branch_name,
        branch_type: branch_type || 'showroom',
        address: address || null,
        phone: phone || null,
        email: email || null,
        manager_id: manager_id || null,
        is_active: true,
      }])
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Tạo branding mặc định cho branch mới
    await supabaseAdmin
      .from('branch_branding')
      .insert([{ branch_id: data.id, store_name: branch_name }]);

    res.status(201).json({ message: `Đã tạo chi nhánh ${branch_name}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getBranding, updateBranding, getBranches, createBranch };
