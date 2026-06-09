const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// ══════════════════════════════════════════════════════════════════
//  FEE SETTINGS — Phí cố định
// ══════════════════════════════════════════════════════════════════

// GET /api/settings/fees?model_id=<uuid>
//   - Không có model_id: trả về tất cả phí global (model_id IS NULL)
//   - Có model_id: trả phí global + phí của riêng mẫu xe đó
const getFees = async (req, res) => {
  try {
    const showAll = req.query.all === 'true';

    let q = getDb(req).from('fee_settings')
      .select('*')
      .order('sort_order');
    if (!showAll) q = q.eq('is_active', true);

    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/settings/fees/:id
const updateFee = async (req, res) => {
  try {
    const { label, amount, is_active, note, sort_order, model_id } = req.body;
    const update = {};
    if (label      !== undefined) update.label      = label;
    if (amount     !== undefined) update.amount      = Number(amount);
    if (is_active  !== undefined) update.is_active   = is_active;
    if (note       !== undefined) update.note        = note;
    if (sort_order !== undefined) update.sort_order  = Number(sort_order);
    if (model_id   !== undefined) update.model_id    = model_id || null;

    const { data, error } = await getDb(req).from('fee_settings')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/settings/fees
const createFee = async (req, res) => {
  try {
    const { key, label, amount, note, sort_order, model_id } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'key và label là bắt buộc' });
    const { data, error } = await getDb(req).from('fee_settings')
      .insert({
        key, label,
        amount:     Number(amount) || 0,
        note,
        sort_order: Number(sort_order) || 99,
        model_id:   model_id || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/settings/fees/:id
const deleteFee = async (req, res) => {
  try {
    const { error } = await getDb(req).from('fee_settings')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
//  REGISTRATION SERVICES — Dịch vụ đăng ký
// ══════════════════════════════════════════════════════════════════

// GET /api/settings/services
const getServices = async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let q = getDb(req).from('registration_services').select('*').order('sort_order');
    if (!showAll) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/settings/services/:id
const updateService = async (req, res) => {
  try {
    const { name, description, price, is_active, sort_order } = req.body;
    const update = {};
    if (name        !== undefined) update.name        = name;
    if (description !== undefined) update.description = description;
    if (price       !== undefined) update.price       = Number(price);
    if (is_active   !== undefined) update.is_active   = is_active;
    if (sort_order  !== undefined) update.sort_order  = Number(sort_order);

    const { data, error } = await getDb(req).from('registration_services')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/settings/services
const createService = async (req, res) => {
  try {
    const { name, description, price, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name là bắt buộc' });
    const { data, error } = await getDb(req).from('registration_services')
      .insert({ name, description, price: Number(price) || 0, sort_order: Number(sort_order) || 99 })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/settings/services/:id
const deleteService = async (req, res) => {
  try {
    const { error } = await getDb(req).from('registration_services')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
//  INSTALLMENT PROVIDERS — Đơn vị tài chính trả góp
// ══════════════════════════════════════════════════════════════════

// GET /api/settings/installment-providers
const getInstallmentProviders = async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let q = getDb(req).from('installment_providers').select('*').order('sort_order');
    if (!showAll) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/settings/installment-providers
const createInstallmentProvider = async (req, res) => {
  try {
    const {
      name, interest_rate_per_month, available_months,
      default_months, min_down_payment_percent, note, sort_order,
    } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên đơn vị tài chính là bắt buộc' });

    const { data, error } = await getDb(req).from('installment_providers')
      .insert({
        name,
        interest_rate_per_month:  Number(interest_rate_per_month) || 0,
        available_months:         Array.isArray(available_months) && available_months.length
                                  ? available_months.map(Number)
                                  : [6, 12, 18, 24, 36],
        default_months:           Number(default_months) || 12,
        min_down_payment_percent: Number(min_down_payment_percent) || 0,
        note,
        sort_order:               Number(sort_order) || 99,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/settings/installment-providers/:id
const updateInstallmentProvider = async (req, res) => {
  try {
    const update = {};
    const fields = [
      'name', 'interest_rate_per_month', 'available_months',
      'default_months', 'min_down_payment_percent', 'note', 'sort_order', 'is_active',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (['interest_rate_per_month', 'default_months', 'min_down_payment_percent', 'sort_order'].includes(f)) {
          update[f] = Number(req.body[f]);
        } else if (f === 'available_months') {
          update[f] = Array.isArray(req.body[f]) ? req.body[f].map(Number) : req.body[f];
        } else {
          update[f] = req.body[f];
        }
      }
    }

    const { data, error } = await getDb(req).from('installment_providers')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/settings/installment-providers/:id
const deleteInstallmentProvider = async (req, res) => {
  try {
    const { error } = await getDb(req).from('installment_providers')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
//  PAYMENT SETTINGS — Cấu hình thanh toán SEPay (theo chi nhánh)
// ══════════════════════════════════════════════════════════════════

const PAYMENT_KEYS = ['bank_code', 'bank_name', 'bank_account', 'bank_account_name', 'sepay_api_key', 'max_cash_allowed', 'loyalty_amount_per_point', 'loyalty_enabled'];

// GET /api/settings/payment  → { bank_code: 'TCB', bank_name: '...', ... }
const getPaymentSettings = async (req, res) => {
  try {
    const branchId = req.user.branch_id || null;

    let q = supabaseAdmin.from('payment_settings')
      .select('key, value')
      .in('key', PAYMENT_KEYS);

    // Lấy settings của chi nhánh, fallback global nếu không có
    if (branchId) {
      q = q.eq('branch_id', branchId);
    } else {
      q = q.is('branch_id', null);
    }

    const { data, error } = await q;
    if (error) throw error;

    const result = {};
    (data || []).forEach(row => { result[row.key] = row.value; });

    // Nếu chi nhánh chưa có config → fallback lấy global
    if (branchId && Object.keys(result).length === 0) {
      const { data: globalData } = await supabaseAdmin.from('payment_settings')
        .select('key, value')
        .in('key', PAYMENT_KEYS)
        .is('branch_id', null);
      (globalData || []).forEach(row => { result[row.key] = row.value; });
    }

    // Đảm bảo tất cả key đều có giá trị (fallback rỗng)
    PAYMENT_KEYS.forEach(k => { if (!(k in result)) result[k] = ''; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/settings/payment  body: { bank_code, bank_name, ... }
const updatePaymentSettings = async (req, res) => {
  try {
    const branchId = req.user.branch_id || null;
    const allowed = PAYMENT_KEYS.filter(k => k in req.body && k !== 'sepay_api_key');
    // sepay_api_key chỉ update khi admin gửi rõ ràng
    if ('sepay_api_key' in req.body && req.user?.role === 'admin') {
      allowed.push('sepay_api_key');
    }
    if (!allowed.length) return res.status(400).json({ error: 'Không có trường hợp lệ để cập nhật' });

    // Upsert theo branch_id
    for (const k of allowed) {
      const value = String(req.body[k] ?? '');

      // Check đã có row cho branch này chưa
      let checkQ = supabaseAdmin.from('payment_settings')
        .select('id')
        .eq('key', k);
      if (branchId) {
        checkQ = checkQ.eq('branch_id', branchId);
      } else {
        checkQ = checkQ.is('branch_id', null);
      }
      const { data: existing } = await checkQ.maybeSingle();

      if (existing) {
        await supabaseAdmin.from('payment_settings')
          .update({ value })
          .eq('id', existing.id);
      } else {
        await supabaseAdmin.from('payment_settings')
          .insert([{ key: k, value, label: '', branch_id: branchId }]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getFees, updateFee, createFee, deleteFee,
  getServices, updateService, createService, deleteService,
  getInstallmentProviders, createInstallmentProvider, updateInstallmentProvider, deleteInstallmentProvider,
  getPaymentSettings, updatePaymentSettings,
};
