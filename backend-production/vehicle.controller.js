const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// Danh sách mẫu xe
const getVehicleModels = async (req, res) => {
  try {
    const { brand, search, page = 1, limit = 20 } = req.query;
    let query = getDb(req).from('vehicle_models')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (brand) query = query.eq('brand', brand);
    if (search) query = query.or(`model_name.ilike.%${search}%,brand.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết mẫu xe
const getVehicleModelDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await getDb(req).from('vehicle_models')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy mẫu xe' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo mẫu xe mới
const createVehicleModel = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('vehicle_models')
      .insert([req.body])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Tạo mẫu xe thành công', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật mẫu xe
const updateVehicleModel = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await getDb(req).from('vehicle_models')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Cập nhật mẫu xe thành công', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Xóa mẫu xe (chỉ khi không có tồn kho)
const deleteVehicleModel = async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra còn xe trong kho không
    const { count } = await getDb(req).from('inventory_vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_model_id', id)
      .eq('status', 'in_stock');

    if (count > 0) {
      return res.status(400).json({ error: `Không thể xóa: còn ${count} xe trong kho` });
    }

    const { error } = await getDb(req).from('vehicle_models').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Xóa mẫu xe thành công' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Danh sách hãng xe
const getBrands = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('vehicle_models')
      .select('brand')
      .order('brand');
    if (error) return res.status(400).json({ error: error.message });

    const brands = [...new Set(data.map(v => v.brand))];
    res.json(brands);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── COLORS MANAGEMENT ───────────────────────────────────────────────────────

// GET /vehicles/:id/colors — danh sách màu + SKU của mẫu xe
const getModelColors = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('vehicle_model_colors')
      .select('id, color_name, color_hex, product_code, image_url, is_active, sort_order, display_order')
      .eq('vehicle_model_id', id)
      .order('sort_order')
      .order('color_name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /vehicles/:id/colors — thêm màu mới
const addModelColor = async (req, res) => {
  try {
    const { id } = req.params;
    const { color_name, color_hex, product_code, image_url, sort_order } = req.body;
    if (!color_name) return res.status(400).json({ error: 'Tên màu là bắt buộc' });

    const { data, error } = await supabaseAdmin
      .from('vehicle_model_colors')
      .insert([{
        vehicle_model_id: id,
        color_name: color_name.trim(),
        color_hex: color_hex || null,
        product_code: product_code ? product_code.trim() : null,
        image_url: image_url || null,
        sort_order: sort_order || 0,
        is_active: true,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Đã thêm màu', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /vehicles/colors/:colorId — cập nhật màu (tên, mã SKU, v.v.)
const updateModelColor = async (req, res) => {
  try {
    const { colorId } = req.params;
    const allowed = ['color_name', 'color_hex', 'product_code', 'image_url', 'is_active', 'sort_order'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (!Object.keys(updates).length)
      return res.status(400).json({ error: 'Không có trường nào được cập nhật' });

    // Trim strings
    if (updates.color_name) updates.color_name = updates.color_name.trim();
    if (updates.product_code) updates.product_code = updates.product_code.trim() || null;

    const { data, error } = await supabaseAdmin
      .from('vehicle_model_colors')
      .update(updates)
      .eq('id', colorId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /vehicles/colors/:colorId
const deleteModelColor = async (req, res) => {
  try {
    const { colorId } = req.params;

    // Kiểm tra còn xe trong kho dùng màu này
    const { count } = await supabaseAdmin
      .from('inventory_vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_color_id', colorId)
      .eq('status', 'in_stock');

    if (count > 0) {
      return res.status(400).json({ error: `Không thể xóa: còn ${count} xe trong kho dùng màu này` });
    }

    const { error } = await supabaseAdmin
      .from('vehicle_model_colors')
      .delete()
      .eq('id', colorId);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã xóa màu' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getVehicleModels, getVehicleModelDetail, createVehicleModel, updateVehicleModel, deleteVehicleModel, getBrands,
  getModelColors, addModelColor, updateModelColor, deleteModelColor,
};
