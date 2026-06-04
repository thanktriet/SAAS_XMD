const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// Danh sách phiếu bảo hành
const getWarranties = async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = getDb(req).from('warranty_records')
      .select(`*, customers(full_name, phone), inventory_vehicles(vin, color, vehicle_models(brand, model_name))`)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (search) query = query.or(`warranty_number.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo phiếu sửa chữa / dịch vụ
const createServiceRequest = async (req, res) => {
  try {
    const { count } = await getDb(req).from('service_requests').select('*', { count: 'exact', head: true });
    const ticket_number = `DV${new Date().getFullYear()}${String(count + 1).padStart(5, '0')}`;
    const { data, error } = await getDb(req).from('service_requests')
      .insert([{ ...req.body, ticket_number }])
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Nếu xe đang sửa chữa, cập nhật trạng thái xe
    if (req.body.inventory_vehicle_id) {
      await getDb(req).from('inventory_vehicles')
        .update({ status: 'warranty_repair' }).eq('id', req.body.inventory_vehicle_id);
    }
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Danh sách phiếu dịch vụ
const getServiceRequests = async (req, res) => {
  try {
    const { status, type } = req.query;
    let query = getDb(req).from('service_requests')
      .select(`
        *,
        customers(full_name, phone),
        inventory_vehicles(vin, vehicle_models(brand, model_name)),
        users!technician_id(full_name)
      `)
      .order('received_date', { ascending: false });
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('service_type', type);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật phiếu dịch vụ
const updateServiceRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await getDb(req).from('service_requests').update(req.body).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Khi hoàn thành, trả xe về in_stock
    if (req.body.status === 'delivered' && data.inventory_vehicle_id) {
      await getDb(req).from('inventory_vehicles')
        .update({ status: 'in_stock' }).eq('id', data.inventory_vehicle_id);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getWarranties, createServiceRequest, getServiceRequests, updateServiceRequest };
