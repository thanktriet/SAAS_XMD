// promotions.controller.js — Quản lý chương trình Khuyến Mãi & Quà Tặng
'use strict';
const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const PROMO_SELECT = `
  *,
  gift_items ( id, code, name, category, qty_in_stock ),
  users!created_by ( full_name )
`;

// ─── Danh sách chương trình KM ───────────────────────────────────────────────
const getPromotions = async (req, res) => {
  try {
    const {
      search    = '',
      type      = '',
      status    = 'all',   // all | active | inactive | expired
      page      = 1,
      limit     = 20,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const today  = new Date().toISOString().slice(0, 10);

    let q = getDb(req).from('promotions')
      .select(PROMO_SELECT, { count: 'exact' });

    if (search.trim()) {
      q = q.or(`name.ilike.%${search}%,promo_code.ilike.%${search}%`);
    }
    if (type) q = q.eq('promo_type', type);

    if (status === 'active') {
      q = q.eq('is_active', true).lte('valid_from', today).gte('valid_until', today);
    } else if (status === 'inactive') {
      q = q.eq('is_active', false);
    } else if (status === 'expired') {
      q = q.lt('valid_until', today);
    }

    q = q.order('created_at', { ascending: false })
         .range(offset, offset + Number(limit) - 1);

    const { data, error, count } = await q;
    if (error) throw error;

    res.json({ data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết 1 chương trình KM ──────────────────────────────────────────────
const getPromoDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const [promoRes, usageRes] = await Promise.all([
      getDb(req).from('promotions').select(PROMO_SELECT).eq('id', id).single(),
      getDb(req).from('sales_order_promotions')
        .select(`
          *,
          sales_orders (
            order_number, order_date, total_amount, status,
            customers ( full_name, customer_code, phone )
          )
        `)
        .eq('promotion_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (promoRes.error) return res.status(404).json({ error: 'Không tìm thấy chương trình khuyến mãi' });
    res.json({ ...promoRes.data, usage_history: usageRes.data ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo chương trình KM mới ─────────────────────────────────────────────────
const createPromo = async (req, res) => {
  try {
    const {
      promo_code,
      name,
      description,
      promo_type        = 'percent',
      discount_percent  = 0,
      discount_amount   = 0,
      min_order_amount  = 0,
      max_discount_cap,
      valid_from,
      valid_until,
      is_active         = true,
      usage_limit,
      applicable_models,
      applicable_brands,
      gift_item_id,
      gift_quantity     = 1,
      note,
    } = req.body;

    if (!name?.trim())    return res.status(400).json({ error: 'Tên chương trình là bắt buộc' });
    if (!valid_from)      return res.status(400).json({ error: 'Ngày bắt đầu là bắt buộc' });
    if (!valid_until)     return res.status(400).json({ error: 'Ngày kết thúc là bắt buộc' });
    if (valid_from > valid_until) return res.status(400).json({ error: 'Ngày bắt đầu phải trước ngày kết thúc' });
    if (promo_type === 'percent' && (discount_percent <= 0 || discount_percent > 100)) {
      return res.status(400).json({ error: 'Phần trăm giảm phải từ 1-100' });
    }
    if (promo_type === 'fixed' && discount_amount <= 0) {
      return res.status(400).json({ error: 'Số tiền giảm phải lớn hơn 0' });
    }
    if ((promo_type === 'gift' || promo_type === 'combo') && !gift_item_id) {
      return res.status(400).json({ error: 'Phải chọn quà tặng kèm cho loại gift/combo' });
    }

    const { data, error } = await getDb(req).from('promotions')
      .insert({
        promo_code: promo_code || null,
        name:               name.trim(),
        description,
        promo_type,
        discount_percent:   Number(discount_percent),
        discount_amount:    Number(discount_amount),
        min_order_amount:   Number(min_order_amount),
        max_discount_cap:   max_discount_cap ? Number(max_discount_cap) : null,
        valid_from,
        valid_until,
        is_active:          Boolean(is_active),
        usage_limit:        usage_limit ? Number(usage_limit) : null,
        applicable_models:  applicable_models?.length ? applicable_models : null,
        applicable_brands:  applicable_brands?.length ? applicable_brands : null,
        gift_item_id:       gift_item_id || null,
        gift_quantity:      Number(gift_quantity),
        note,
        created_by:         req.user?.id,
      })
      .select(PROMO_SELECT)
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Mã khuyến mãi đã tồn tại' });
    res.status(500).json({ error: err.message });
  }
};

// ─── Cập nhật chương trình KM ─────────────────────────────────────────────────
const updatePromo = async (req, res) => {
  try {
    const { id } = req.params;

    // Không cho sửa nếu đã dùng và đang active
    const { data: current } = await getDb(req).from('promotions').select('usage_count, is_active').eq('id', id).single();
    if (!current) return res.status(404).json({ error: 'Không tìm thấy chương trình khuyến mãi' });

    const {
      name, description, promo_type, discount_percent, discount_amount,
      min_order_amount, max_discount_cap, valid_from, valid_until,
      is_active, usage_limit, applicable_models, applicable_brands,
      gift_item_id, gift_quantity, note,
    } = req.body;

    const payload = {};
    if (name           !== undefined) payload.name              = name.trim();
    if (description    !== undefined) payload.description       = description;
    if (promo_type     !== undefined) payload.promo_type        = promo_type;
    if (discount_percent !== undefined) payload.discount_percent = Number(discount_percent);
    if (discount_amount  !== undefined) payload.discount_amount  = Number(discount_amount);
    if (min_order_amount !== undefined) payload.min_order_amount = Number(min_order_amount);
    if (max_discount_cap !== undefined) payload.max_discount_cap = max_discount_cap ? Number(max_discount_cap) : null;
    if (valid_from     !== undefined) payload.valid_from        = valid_from;
    if (valid_until    !== undefined) payload.valid_until       = valid_until;
    if (is_active      !== undefined) payload.is_active         = Boolean(is_active);
    if (usage_limit    !== undefined) payload.usage_limit       = usage_limit ? Number(usage_limit) : null;
    if (applicable_models !== undefined) payload.applicable_models = applicable_models?.length ? applicable_models : null;
    if (applicable_brands !== undefined) payload.applicable_brands = applicable_brands?.length ? applicable_brands : null;
    if (gift_item_id   !== undefined) payload.gift_item_id     = gift_item_id || null;
    if (gift_quantity  !== undefined) payload.gift_quantity    = Number(gift_quantity);
    if (note           !== undefined) payload.note             = note;

    const { data, error } = await getDb(req).from('promotions').update(payload).eq('id', id).select(PROMO_SELECT).single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Bật/tắt trạng thái KM ───────────────────────────────────────────────────
const togglePromo = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: current } = await getDb(req).from('promotions').select('is_active').eq('id', id).single();
    if (!current) return res.status(404).json({ error: 'Không tìm thấy' });

    const { data, error } = await getDb(req).from('promotions')
      .update({ is_active: !current.is_active })
      .eq('id', id).select('id, is_active, name').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Các KM đang hoạt động (dùng trong POS khi tạo đơn) ──────────────────────
const getActivePromos = async (req, res) => {
  try {
    const { order_amount, model_id, brand } = req.query;

    const { data, error } = await getDb(req).from('v_active_promotions')
      .select('*')
      .order('discount_percent', { ascending: false });

    if (error) throw error;

    // Lọc phía server: theo số tiền đơn và mẫu xe
    let filtered = data ?? [];

    if (order_amount) {
      const amt = Number(order_amount);
      filtered = filtered.filter(p => amt >= (p.min_order_amount || 0));
    }

    if (model_id) {
      filtered = filtered.filter(p =>
        !p.applicable_models?.length || p.applicable_models.includes(model_id)
      );
    }

    if (brand) {
      filtered = filtered.filter(p =>
        !p.applicable_brands?.length || p.applicable_brands.includes(brand)
      );
    }

    // Map flat fields của view → nested object gift_items để frontend dùng thống nhất
    filtered = filtered.map(p => ({
      ...p,
      gift_items: p.gift_item_id
        ? { id: p.gift_item_id, name: p.gift_item_name, code: p.gift_item_code, category: p.gift_item_category }
        : null,
    }));

    res.json({ data: filtered, total: filtered.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Áp dụng KM vào đơn hàng ─────────────────────────────────────────────────
const applyPromoToOrder = async (req, res) => {
  try {
    const { promo_id, order_id, note } = req.body;
    if (!promo_id || !order_id) return res.status(400).json({ error: 'Thiếu promo_id hoặc order_id' });

    // Kiểm tra KM còn hiệu lực
    const today = new Date().toISOString().slice(0, 10);
    const { data: promo } = await getDb(req).from('promotions')
      .select('*')
      .eq('id', promo_id)
      .eq('is_active', true)
      .lte('valid_from', today)
      .gte('valid_until', today)
      .single();

    if (!promo) return res.status(400).json({ error: 'Chương trình khuyến mãi không còn hiệu lực' });
    if (promo.usage_limit && promo.usage_count >= promo.usage_limit) {
      return res.status(400).json({ error: 'Chương trình khuyến mãi đã hết lượt sử dụng' });
    }

    // Lấy đơn hàng để tính chiết khấu
    const { data: order } = await getDb(req).from('sales_orders').select('total_amount, customer_id, status').eq('id', order_id).single();
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (!['draft', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ error: 'Chỉ áp dụng KM cho đơn ở trạng thái draft hoặc confirmed' });
    }
    if (order.total_amount < (promo.min_order_amount || 0)) {
      return res.status(400).json({
        error: `Đơn hàng phải đạt tối thiểu ${promo.min_order_amount?.toLocaleString('vi-VN')} ₫ để áp dụng KM này`,
      });
    }

    // Tính số tiền giảm thực tế
    let discount_applied = 0;
    if (promo.promo_type === 'percent') {
      discount_applied = order.total_amount * promo.discount_percent / 100;
      if (promo.max_discount_cap) discount_applied = Math.min(discount_applied, promo.max_discount_cap);
    } else if (promo.promo_type === 'fixed') {
      discount_applied = Math.min(promo.discount_amount, order.total_amount);
    }
    // gift/combo: giảm 0 đồng, sẽ tặng quà riêng

    // Lưu bản ghi promo_usage
    const { data: usage, error: usageErr } = await getDb(req).from('promo_usage')
      .insert({
        promo_id,
        order_id,
        customer_id:      order.customer_id,
        discount_applied,
        note,
        applied_by:       req.user?.id,
      })
      .select('*')
      .single();

    if (usageErr) {
      if (usageErr.code === '23505') return res.status(409).json({ error: 'KM này đã được áp dụng cho đơn hàng' });
      throw usageErr;
    }

    // Cập nhật discount_amount trên đơn hàng
    if (discount_applied > 0) {
      await getDb(req).from('sales_orders')
        .update({
          discount_amount: discount_applied,
          total_amount:    order.total_amount - discount_applied,
        })
        .eq('id', order_id);
    }

    res.status(201).json({ usage, discount_applied, promo_type: promo.promo_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Lịch sử sử dụng KM (tổng hợp) ──────────────────────────────────────────
const getPromoUsage = async (req, res) => {
  try {
    const { promo_id, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let q = getDb(req).from('promo_usage')
      .select(`
        *,
        promotions ( promo_code, name, promo_type ),
        sales_orders ( order_number, order_date, total_amount ),
        customers ( full_name, customer_code, phone )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (promo_id) q = q.eq('promo_id', promo_id);

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Thống kê nhanh cho stat cards ───────────────────────────────────────────
const getPromoStats = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const soon  = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const [totalRes, activeRes, expiringRes, usageRes] = await Promise.all([
      getDb(req).from('promotions').select('id', { count: 'exact', head: true }),
      getDb(req).from('promotions').select('id', { count: 'exact', head: true })
        .eq('is_active', true).lte('valid_from', today).gte('valid_until', today),
      getDb(req).from('promotions').select('id', { count: 'exact', head: true })
        .eq('is_active', true).gte('valid_until', today).lte('valid_until', soon),
      getDb(req).from('promo_usage').select('discount_applied'),
    ]);

    const totalDiscount = (usageRes.data ?? [])
      .reduce((s, r) => s + Number(r.discount_applied || 0), 0);

    res.json({
      total:          totalRes.count    ?? 0,
      active:         activeRes.count   ?? 0,
      expiring_soon:  expiringRes.count ?? 0,
      total_discount: totalDiscount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getPromotions,
  getPromoDetail,
  createPromo,
  updatePromo,
  togglePromo,
  getActivePromos,
  applyPromoToOrder,
  getPromoUsage,
  getPromoStats,
};
