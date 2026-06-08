const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { generateCode } = require('./codeGenerator');

// Các cột kiểu DATE — chuỗi rỗng phải được đổi thành null
const DATE_FIELDS = ['id_card_date', 'date_of_birth'];

// Làm sạch body: chuỗi rỗng → null, DATE rỗng → null tường minh
function sanitize(body) {
  const out = { ...body };
  for (const key of DATE_FIELDS) {
    if (key in out && (out[key] === '' || out[key] === null)) {
      out[key] = null;
    }
  }
  return out;
}

// Chuẩn hoá SĐT: bỏ ký tự không phải số, đổi +84 → 0 ở đầu
function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/\D/g, '');           // chỉ giữ chữ số
  if (s.startsWith('84') && s.length >= 10) s = '0' + s.slice(2);
  return s;
}

// Danh sách khách hàng — Sales chỉ xem KH do mình làm chủ
// Trừ trường hợp tra cứu chính xác bằng phone_exact (POS) — ai cũng tìm được
const getCustomers = async (req, res) => {
  try {
    const { search, phone_exact, page = 1, limit = 20 } = req.query;

    // Tra cứu nhanh trong POS: nhập đủ SĐT thì ai cũng thấy KH (bỏ qua filter sales)
    // Chuẩn hoá cả 2 phía để khớp dù DB lưu "0901 234 567" hay "+84901234567"
    if (phone_exact) {
      const target = normalizePhone(phone_exact);
      if (target.length < 9) {
        return res.json({ data: [], total: 0, page: 1, limit: +limit });
      }
      // Lấy danh sách rộng theo 9 số cuối, sau đó so khớp chuẩn hoá ở Node
      const last9 = target.slice(-9);
      const { data: rough, error } = await getDb(req).from('customers')
        .select('*')
        .ilike('phone', `%${last9}%`)
        .limit(50);
      if (error) return res.status(400).json({ error: error.message });
      const matched = (rough || []).filter(c => normalizePhone(c.phone) === target);
      return res.json({ data: matched, total: matched.length, page: 1, limit: +limit });
    }

    let query = getDb(req).from('customers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    // Sales chỉ xem KH của mình khi xem danh sách
    if (req.user?.role === 'sales') {
      query = query.eq('salesperson_id', req.user.sub);
    }

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,customer_code.ilike.%${search}%,email.ilike.%${search}%`);
    }
    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Thêm khách hàng — tự gán salesperson_id nếu là sales
const createCustomer = async (req, res) => {
  try {
  // Lấy mã KH có prefix chi nhánh
    const customer_code = await generateCode(req, {
      table: 'customers', column: 'customer_code',
      prefix: 'KH', padLength: 6, yearInPrefix: false,
    });

    // Sales: bắt buộc salesperson_id = chính họ; admin/manager: theo body hoặc null
    const body = sanitize(req.body);
    if (req.user?.role === 'sales') {
      body.salesperson_id = req.user.sub;
    }

    const { data, error } = await getDb(req).from('customers')
      .insert([{ ...body, customer_code }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết khách hàng
//   - Admin/Manager: xem được tất cả
//   - Sales: xem được KH của mình HOẶC KH có đơn hàng do mình lập
const getCustomerDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const customerRes = await getDb(req).from('customers')
      .select('*')
      .eq('id', id)
      .single();
    if (customerRes.error || !customerRes.data) {
      return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    }

    // Sales: kiểm tra quyền xem
    if (req.user?.role === 'sales') {
      const isOwner = customerRes.data.salesperson_id === req.user.sub;
      if (!isOwner) {
        // Cho phép nếu sales đã lập ít nhất 1 đơn với KH này
        const { count } = await getDb(req).from('sales_orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', id)
          .eq('salesperson_id', req.user.sub);
        if (!count) {
          return res.status(403).json({ error: 'Bạn không có quyền xem khách hàng này' });
        }
      }
    }

    const [ordersRes, warrantyRes] = await Promise.all([
      getDb(req).from('sales_orders').select(`
        *, sales_order_items(*, vehicle_models(brand, model_name))
      `).eq('customer_id', id).order('order_date', { ascending: false }),
      getDb(req).from('warranty_records').select(`
        *, inventory_vehicles(vin, vehicle_models(brand, model_name))
      `).eq('customer_id', id),
    ]);

    res.json({
      customer:   customerRes.data,
      orders:     ordersRes.data,
      warranties: warrantyRes.data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật khách hàng — Sales chỉ sửa được KH của chính mình HOẶC KH có đơn của mình
const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user?.role === 'sales') {
      const { data: cur, error: chkErr } = await getDb(req).from('customers')
        .select('salesperson_id')
        .eq('id', id)
        .single();
      if (chkErr || !cur) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

      const isOwner = cur.salesperson_id === req.user.sub;
      let allowed = isOwner;
      if (!allowed) {
        // Cho phép nếu KH có đơn do sales này lập
        const { count } = await getDb(req).from('sales_orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', id)
          .eq('salesperson_id', req.user.sub);
        allowed = (count ?? 0) > 0;
      }
      if (!allowed) {
        return res.status(403).json({ error: 'Bạn chỉ được sửa khách hàng do mình quản lý hoặc đã có đơn' });
      }
      // Sales không được đổi chủ KH
      if ('salesperson_id' in req.body) delete req.body.salesperson_id;
    }

    const { data, error } = await getDb(req).from('customers')
      .update(sanitize(req.body))
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getCustomers, createCustomer, getCustomerDetail, updateCustomer };
