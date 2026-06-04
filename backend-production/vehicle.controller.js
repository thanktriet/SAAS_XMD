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

module.exports = { getVehicleModels, getVehicleModelDetail, createVehicleModel, updateVehicleModel, deleteVehicleModel, getBrands };
