const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const userId = (req) => req.user?.sub || req.user?.id || null;

const pickGiftFields = (body, isCreate = false) => {
  const allowed = ['name', 'category', 'unit', 'qty_minimum', 'price_cost',
                   'campaign_id', 'valid_from', 'valid_until',
                   'compatible_models', 'image_url', 'note', 'is_active'];
  const obj = {};
  allowed.forEach(f => { if (body[f] !== undefined) obj[f] = body[f]; });
  if (isCreate) {
    obj.unit         = obj.unit        ?? 'cái';
    obj.qty_minimum  = obj.qty_minimum ?? 1;
    obj.price_cost   = obj.price_cost  ?? 0;
    obj.qty_in_stock = 0;
    obj.is_active    = true;
    // code tự sinh bởi trigger generate_gift_code
  }
  return obj;
};

// ─── Danh sách quà tặng ───────────────────────────────────────────────────────
const getGiftItems = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const { search, category, is_active, low_stock } = req.query;

    let q = getDb(req).from('gift_items')
      .select('*', { count: 'exact' })
      .order('name');

    if (is_active === 'all') { /* không lọc */ }
    else if (is_active === 'false') q = q.eq('is_active', false);
    else q = q.eq('is_active', true);

    if (category) q = q.eq('category', category);
    if (search)   q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    if (low_stock === 'true') q = q.lte('qty_in_stock', supabaseAdmin.raw('qty_minimum'));

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết một quà tặng ────────────────────────────────────────────────────
const getGiftItemById = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('gift_items')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy quà tặng' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo quà tặng mới ─────────────────────────────────────────────────────────
const createGiftItem = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Thiếu tên quà tặng' });

    const fields = pickGiftFields(req.body, true);
    const { data, error } = await getDb(req).from('gift_items')
      .insert([fields])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: `Đã thêm quà tặng "${data.name}"`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Cập nhật quà tặng ────────────────────────────────────────────────────────
const updateGiftItem = async (req, res) => {
  try {
    const { id } = req.params;
    const fields = pickGiftFields(req.body, false);
    if (Object.keys(fields).length === 0)
      return res.status(400).json({ error: 'Không có trường nào để cập nhật' });

    const { data, error } = await getDb(req).from('gift_items')
      .update(fields)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật quà tặng', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Nhập kho quà tặng (vật phẩm) ────────────────────────────────────────────
const giftStockIn = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, unit_cost, note, reference_code, supplier } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: 'Số lượng nhập phải > 0' });

    const { data: item, error: fetchErr } = await getDb(req).from('gift_items').select('name, qty_in_stock, unit').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy quà tặng' });

    const { error: mvErr } = await getDb(req).from('item_movements')
      .insert([{
        item_type:      'gift',
        item_id:        id,
        movement_type:  'import',
        quantity:       +quantity,       // dương = nhập vào
        unit_cost:      unit_cost  || 0,
        reference_code: reference_code || null,
        supplier:       supplier   || null,
        note:           note       || null,
        created_by:     userId(req),
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });

    const tonMoi = item.qty_in_stock + (+quantity);
    res.json({ message: `Đã nhập ${quantity} ${item.unit} "${item.name}" (tồn mới: ${tonMoi})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Xuất / phát quà kèm đơn hàng ────────────────────────────────────────────
const giftStockOut = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, order_id, note } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: 'Số lượng phát phải > 0' });

    const { data: item, error: fetchErr } = await getDb(req).from('gift_items').select('name, qty_in_stock, unit').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy quà tặng' });

    if (item.qty_in_stock < quantity)
      return res.status(409).json({ error: `Tồn kho không đủ (hiện có: ${item.qty_in_stock} ${item.unit})` });

    const { error: mvErr } = await getDb(req).from('item_movements')
      .insert([{
        item_type:     'gift',
        item_id:       id,
        movement_type: 'export_gift',
        quantity:      -(+quantity),   // âm = xuất ra
        order_id:      order_id || null,
        note:          note     || `Phát quà${order_id ? ' kèm đơn ' + order_id : ''}`,
        created_by:    userId(req),
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });

    const tonMoi = item.qty_in_stock - (+quantity);
    res.json({ message: `Đã phát ${quantity} ${item.unit} "${item.name}" (tồn mới: ${tonMoi})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Lịch sử nhập/xuất kho quà tặng ─────────────────────────────────────────
const getGiftMovements = async (req, res) => {
  try {
    const { id } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);

    const { data: movements, count, error } = await getDb(req).from('item_movements')
      .select('*', { count: 'exact' })
      .eq('item_type', 'gift')
      .eq('item_id', id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) return res.status(400).json({ error: error.message });

    // Enrich riêng — tránh lỗi FK ambiguity
    const userIds  = [...new Set((movements || []).map(m => m.created_by).filter(Boolean))];
    const orderIds = [...new Set((movements || []).map(m => m.sales_order_id).filter(Boolean))];

    const [usersRes, ordersRes] = await Promise.all([
      userIds.length
        ? getDb(req).from('users').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] }),
      orderIds.length
        ? getDb(req).from('sales_orders').select('id, order_number').in('id', orderIds)
        : Promise.resolve({ data: [] }),
    ]);

    const userMap  = new Map((usersRes.data || []).map(u => [u.id, u.full_name]));
    const orderMap = new Map((ordersRes.data || []).map(o => [o.id, o.order_number]));

    const enriched = (movements || []).map(m => ({
      ...m,
      users: m.created_by ? { full_name: userMap.get(m.created_by) || '—' } : null,
      sales_orders: m.sales_order_id ? { order_number: orderMap.get(m.sales_order_id) || null } : null,
    }));

    res.json({ data: enriched, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Quà tặng theo đơn hàng ───────────────────────────────────────────────────
const getOrderGifts = async (req, res) => {
  try {
    const { order_id } = req.params;
    const { data, error } = await getDb(req).from('order_gifts')
      .select('*, gift_items(code, name, unit), accessories(code, name, unit), users!created_by(full_name)')
      .eq('order_id', order_id)
      .order('created_at');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Gắn quà vào đơn hàng ────────────────────────────────────────────────────
const addOrderGift = async (req, res) => {
  try {
    const { order_id } = req.params;
    const { gift_item_id, accessory_id, quantity = 1, gift_type = 'free', sale_price = 0, note } = req.body;

    if (!gift_item_id && !accessory_id)
      return res.status(400).json({ error: 'Phải chọn gift_item_id hoặc accessory_id' });
    if (gift_item_id && accessory_id)
      return res.status(400).json({ error: 'Chỉ chọn một trong hai: gift_item_id hoặc accessory_id' });

    const { data, error } = await getDb(req).from('order_gifts')
      .insert([{
        order_id,
        gift_item_id:  gift_item_id  || null,
        accessory_id:  accessory_id  || null,
        quantity:      +quantity,
        gift_type,
        sale_price:    +sale_price,
        note:          note          || null,
        created_by:    userId(req),
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Đã gắn quà tặng vào đơn hàng', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Xác nhận phát quà (issued) → trigger tự tạo item_movement ──────────────
const issueOrderGift = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await getDb(req).from('order_gifts')
      .update({ status: 'issued', issued_by: userId(req) })
      .eq('id', id)
      .eq('status', 'pending')         // chỉ update khi đang pending
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(409).json({ error: 'Quà đã phát hoặc không tồn tại' });
    res.json({ message: 'Đã xác nhận phát quà', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Cảnh báo tồn quà tặng thấp ──────────────────────────────────────────────
const getGiftLowStock = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('v_gift_stock_alert')
      .select('*')
      .order('surplus');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getGiftItems,
  getGiftItemById,
  createGiftItem,
  updateGiftItem,
  giftStockIn,
  giftStockOut,
  getGiftMovements,
  getOrderGifts,
  addOrderGift,
  issueOrderGift,
  getGiftLowStock,
};
