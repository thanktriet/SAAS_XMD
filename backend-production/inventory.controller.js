const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// Lấy danh sách kho xe
const getInventory = async (req, res) => {
  try {
    const { status, model_id, color, page = 1, limit = 20 } = req.query;
    let query = getDb(req).from('inventory_vehicles')
      .select(`
        *,
        vehicle_models (brand, model_name, category, price_sell, image_url)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) query = query.eq('status', status);
    if (model_id) query = query.eq('vehicle_model_id', model_id);
    if (color) query = query.ilike('color', `%${color}%`);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Thêm xe vào kho
const addVehicle = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('inventory_vehicles')
      .insert([req.body])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật trạng thái xe
const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await getDb(req).from('inventory_vehicles')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tóm tắt tồn kho
const getStockSummary = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('v_vehicle_stock_summary')
      .select('*');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Phụ tùng ─────────────────────────────────────────────────────────────────

// Danh sách phụ tùng (hỗ trợ tìm kiếm, phân trang, lọc)
const getSpareParts = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const { search, category, is_active } = req.query;

    let q = getDb(req).from('spare_parts')
      .select('*', { count: 'exact' })
      .order('name');

    // Mặc định chỉ lấy active, trừ khi is_active='all'
    if (is_active !== 'all') {
      q = q.eq('is_active', is_active === 'false' ? false : true);
    }
    if (category) q = q.eq('category', category);
    if (search)   q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%`);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết một phụ tùng
const getSparePartById = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('spare_parts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy phụ tùng' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo phụ tùng mới
const createSparePart = async (req, res) => {
  try {
    const { code, name, category, unit, qty_minimum, price_cost, price_sell, supplier } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Thiếu mã và tên phụ tùng' });

    const { data, error } = await getDb(req).from('spare_parts')
      .insert([{
        code, name,
        category: category || null,
        unit: unit || 'cái',
        qty_in_stock: 0,
        qty_minimum: qty_minimum ?? 5,
        price_cost: price_cost || 0,
        price_sell: price_sell || 0,
        supplier: supplier || null,
        is_active: true,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: `Đã tạo phụ tùng ${name}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật thông tin phụ tùng
const updateSparePart = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'category', 'unit', 'qty_minimum', 'price_cost', 'price_sell', 'supplier', 'is_active'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const { data, error } = await getDb(req).from('spare_parts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật phụ tùng', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Nhập kho phụ tùng
const stockIn = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, notes } = req.body;
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Số lượng nhập phải > 0' });

    const { data: part, error: fetchErr } = await getDb(req).from('spare_parts').select('qty_in_stock, name').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy phụ tùng' });

    const before = part.qty_in_stock;
    const after  = before + quantity;

    // Tạo stock_movement → trigger tự cộng qty_in_stock
    const { error: mvErr } = await getDb(req).from('stock_movements')
      .insert([{
        spare_part_id:   id,
        movement_type:   'import',
        quantity,
        quantity_before: before,
        quantity_after:  after,
        notes:           notes || null,
        created_by:      req.user?.sub || null,
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });
    res.json({ message: `Đã nhập ${quantity} ${part.name} vào kho (tồn mới: ${after})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Xuất kho phụ tùng
const stockOut = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, notes } = req.body;
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Số lượng xuất phải > 0' });

    const { data: part, error: fetchErr } = await getDb(req).from('spare_parts').select('qty_in_stock, name').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy phụ tùng' });

    if (part.qty_in_stock < quantity)
      return res.status(409).json({ error: `Tồn kho không đủ (hiện có: ${part.qty_in_stock})` });

    const before = part.qty_in_stock;
    const after  = before - quantity;

    const { error: mvErr } = await getDb(req).from('stock_movements')
      .insert([{
        spare_part_id:   id,
        movement_type:   'export',
        quantity,
        quantity_before: before,
        quantity_after:  after,
        notes:           notes || null,
        created_by:      req.user?.sub || null,
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });
    res.json({ message: `Đã xuất ${quantity} ${part.name} khỏi kho (tồn mới: ${after})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Lịch sử nhập/xuất kho của một phụ tùng
const getStockMovements = async (req, res) => {
  try {
    const { id } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);

    const { data, count, error } = await getDb(req).from('stock_movements')
      .select('*, users(full_name)', { count: 'exact' })
      .eq('spare_part_id', id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cảnh báo tồn kho thấp
const getLowStockAlert = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('spare_parts')
      .select('*')
      .filter('qty_in_stock', 'lte', 'qty_minimum')
      .eq('is_active', true)
      .order('qty_in_stock');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Xóa xe khỏi kho (chỉ được xóa khi status = in_stock hoặc demo)
const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra trạng thái trước khi xóa
    const { data: xe, error: fetchErr } = await getDb(req).from('inventory_vehicles')
      .select('status, vin')
      .eq('id', id)
      .single();

    if (fetchErr || !xe) return res.status(404).json({ error: 'Không tìm thấy xe' });
    if (['sold', 'warranty_repair'].includes(xe.status)) {
      return res.status(400).json({ error: `Không thể xóa xe ${xe.vin} đang có trạng thái "${xe.status}"` });
    }

    const { error } = await getDb(req).from('inventory_vehicles').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: `Đã xóa xe ${xe.vin} khỏi kho` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getInventory, addVehicle, updateVehicle, deleteVehicle, getStockSummary,
  getSpareParts, getSparePartById, createSparePart, updateSparePart,
  stockIn, stockOut, getStockMovements, getLowStockAlert,
};
