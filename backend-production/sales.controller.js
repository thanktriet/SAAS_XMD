const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { awardLoyaltyPoints } = require('./loyalty.service');
const { validateBatteryItems, createAssignments, isBatteryAccessory } = require('./battery.service');

// ══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE — luồng chuyển trạng thái hợp lệ
// ══════════════════════════════════════════════════════════════════════════════

const VALID_TRANSITIONS = {
  draft:              ['confirmed', 'cancelled'],
  confirmed:          ['deposit_paid', 'full_paid', 'cancelled', 'draft'],
  deposit_paid:       ['full_paid', 'cancelled', 'draft'],
  full_paid:          ['invoice_requested', 'cancelled', 'draft'],
  invoice_requested:  ['invoice_approved', 'cancelled', 'draft'],
  invoice_approved:   ['pdi_pending', 'draft'],
  pdi_pending:        ['pdi_done', 'cancelled', 'draft'],
  pdi_done:           ['delivered', 'cancelled', 'draft'],
  delivered:          ['draft'],          // admin/manager mở lại
  cancelled:          ['draft'],          // admin/manager mở lại
};

// Quyền theo khoá "fromStatus→toStatus"
const TRANSITION_ROLES = {
  'draft→confirmed':                    ['sales', 'manager', 'admin'],
  'confirmed→deposit_paid':             ['sales', 'accountant', 'manager', 'admin'],
  'deposit_paid→deposit_paid':          ['sales', 'accountant', 'manager', 'admin'],
  'confirmed→full_paid':                ['accountant', 'manager', 'admin'],
  'deposit_paid→full_paid':             ['accountant', 'manager', 'admin'],
  'full_paid→invoice_requested':        ['sales', 'manager', 'admin'],
  'invoice_requested→invoice_approved': ['manager', 'admin'],
  'invoice_approved→pdi_pending':       ['manager', 'admin'],  // fix: tự động nhưng cần khai báo
  'pdi_pending→pdi_done':               ['technician', 'manager', 'admin'],
  'pdi_done→delivered':                 ['sales', 'manager', 'admin'],
};
// cancelled: mọi trạng thái (trừ delivered) → admin + manager
// đặc biệt: draft → cancelled thêm sales

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function canTransition(fromStatus, toStatus, userRole) {
  // Reopen — đưa status từ bất kỳ về 'draft' — chỉ admin/manager
  if (toStatus === 'draft' && fromStatus !== 'draft') {
    return ['admin', 'manager'].includes(userRole);
  }

  // Terminal states
  if (!VALID_TRANSITIONS[fromStatus]) return false;
  if (!VALID_TRANSITIONS[fromStatus].includes(toStatus)) return false;

  // Chuyển sang cancelled — chỉ admin/manager
  if (toStatus === 'cancelled') {
    return ['admin', 'manager'].includes(userRole);
  }

  const key = `${fromStatus}→${toStatus}`;
  const allowed = TRANSITION_ROLES[key];
  if (!allowed) return false;
  return allowed.includes(userRole);
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSITION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

async function handleConfirm(orderId) {
  // Bắt buộc mọi item phải có inventory_vehicle_id (số VIN) trước khi xác nhận đơn
  const { data: items, error: itemsErr } = await getDb(req).from('sales_order_items')
    .select('id, inventory_vehicle_id')
    .eq('order_id', orderId);
  if (itemsErr) throw new Error(itemsErr.message);
  if (!items || items.length === 0) {
    const e = new Error('Đơn không có sản phẩm nào');
    e.status = 400;
    throw e;
  }
  const thieuVin = items.filter(i => !i.inventory_vehicle_id);
  if (thieuVin.length > 0) {
    const e = new Error(`Chưa thể xác nhận: ${thieuVin.length} xe trong đơn chưa có số VIN. Mở đơn để gán xe cụ thể.`);
    e.status = 400;
    throw e;
  }

  const { data, error } = await getDb(req).from('sales_orders')
    .update({ status: 'confirmed' })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleDepositPaid(orderId, deposit_amount, currentDeposit) {
  const totalDeposit = (currentDeposit || 0) + parseFloat(deposit_amount);
  const { data, error } = await getDb(req).from('sales_orders')
    .update({ status: 'deposit_paid', deposit_amount: totalDeposit })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleFullPaid(orderId, { receipt_number, receipt_date, payment_note }, orderData) {
  // Kiểm tra số phiếu thu không trùng
  const { data: existing } = await getDb(req).from('sales_orders')
    .select('id')
    .eq('receipt_number', receipt_number)
    .neq('id', orderId)
    .maybeSingle();
  if (existing) throw { status: 422, message: `Số phiếu thu "${receipt_number}" đã tồn tại` };

  const { data: order, error } = await getDb(req).from('sales_orders')
    .update({ status: 'full_paid', receipt_number, receipt_date, payment_note })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Sinh giao dịch tài chính — thu đủ tiền
  const { data: lastFT } = await getDb(req).from('finance_transactions')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ftNum = `THU-${orderData.order_number}-${receipt_number}`;

  await getDb(req).from('finance_transactions').insert([{
    transaction_number:  ftNum,
    type:                'income',
    category:            'ban_hang',
    amount:              orderData.total_amount,
    payment_method:      orderData.payment_method,
    reference_id:        orderId,
    reference_type:      'sales_order',
    description:         `Thu đủ tiền đơn hàng ${orderData.order_number} — phiếu ${receipt_number}`,
    transaction_date:    receipt_date,
    notes:               payment_note || null,
  }]);

  return order;
}

async function handleInvoiceRequested(orderId) {
  const { data, error } = await getDb(req).from('sales_orders')
    .update({ status: 'invoice_requested' })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleInvoiceApproved(orderId, approverId) {
  // Hai bước trong một: invoice_approved → pdi_pending (tự động)
  // Lưu approved_by, rồi ngay lập tức chuyển sang pdi_pending
  const { error: e1 } = await getDb(req).from('sales_orders')
    .update({ status: 'invoice_approved', approved_by: approverId })
    .eq('id', orderId);
  if (e1) throw new Error(e1.message);

  const { data, error: e2 } = await getDb(req).from('sales_orders')
    .update({ status: 'pdi_pending' })
    .eq('id', orderId)
    .select()
    .single();
  if (e2) throw new Error(e2.message);
  return data; // trả về pdi_pending
}

async function handlePdiDone(orderId, pdi_notes, technicianId) {
  const { data, error } = await getDb(req).from('sales_orders')
    .update({ status: 'pdi_done', pdi_notes, technician_id: technicianId })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleDeliver(orderId, existingDeliveryDate) {
  const deliveryDate = existingDeliveryDate || new Date().toISOString().split('T')[0];
  const { data: order, error } = await getDb(req).from('sales_orders')
    .update({ status: 'delivered', delivery_date: deliveryDate })
    .eq('id', orderId)
    .select(`
      *,
      sales_order_items(inventory_vehicle_id, vehicle_models(warranty_months), inventory_vehicles(vin)),
      sales_order_accessories(accessory_id, quantity, serial_numbers, assignment_type)
    `)
    .single();
  if (error) throw new Error(error.message);

  // Cộng điểm tích lũy cho KH theo total_amount đơn
  if (order.customer_id && order.total_amount) {
    await awardLoyaltyPoints(order.customer_id, order.total_amount, `sales_order:${order.order_number}`);
  }

  // Gắn pin với KH (chỉ khi item là pin) — lấy VIN xe đầu tiên trong đơn làm vehicle_vin
  const firstVehicle = (order.sales_order_items || []).find(i => i.inventory_vehicles?.vin);
  const vehicleVin   = firstVehicle?.inventory_vehicles?.vin || null;
  const vehicleId    = firstVehicle?.inventory_vehicle_id || null;

  if ((order.sales_order_accessories ?? []).length > 0) {
    try {
      await createAssignments({
        items:        order.sales_order_accessories,
        customerId:   order.customer_id,
        vehicleVin,
        vehicleId,
        sourceType:   'sales_order',
        sourceId:     orderId,
      });
    } catch (e) {
      console.error('[sales-deliver] gắn pin thất bại:', e.message);
    }
  }

  // Tạo hồ sơ bảo hành cho từng xe
  for (const item of order.sales_order_items || []) {
    if (!item.inventory_vehicle_id) continue;
    const months = item.vehicle_models?.warranty_months || 24;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const { count } = await getDb(req).from('warranty_records')
      .select('*', { count: 'exact', head: true });
    await getDb(req).from('warranty_records').insert([{
      warranty_number:      `BH${String((count || 0) + 1).padStart(6, '0')}`,
      customer_id:          order.customer_id,
      inventory_vehicle_id: item.inventory_vehicle_id,
      sales_order_id:       orderId,
      start_date:           startDate.toISOString().split('T')[0],
      end_date:             endDate.toISOString().split('T')[0],
      status:               'active',
    }]);
  }
  return order;
}

async function handleCancel(orderId, cancel_reason, order) {
  const currentStatus = order.status;

  const { data, error } = await getDb(req).from('sales_orders')
    .update({ status: 'cancelled', cancel_reason })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Tạo giao dịch hoàn tiền nếu đơn đã thu tiền
  const paidStatuses = ['full_paid', 'invoice_requested', 'invoice_approved', 'pdi_pending', 'pdi_done'];
  if (paidStatuses.includes(currentStatus) && (order.total_amount ?? 0) > 0) {
    const refundNum = `HOAN-${order.order_number}`;
    await getDb(req).from('finance_transactions').insert([{
      transaction_number: refundNum,
      type:               'expense',
      category:           'hoan_tien',
      amount:             order.total_amount,
      payment_method:     order.payment_method || 'cash',
      reference_id:       orderId,
      reference_type:     'sales_order',
      description:        `Hoàn tiền huỷ đơn ${order.order_number} — lý do: ${cancel_reason}`,
      transaction_date:   new Date().toISOString().split('T')[0],
    }]);
  }

  // Hoàn tiền cọc (nếu đơn chỉ ở deposit_paid)
  if (currentStatus === 'deposit_paid' && (order.deposit_amount ?? 0) > 0) {
    const refundNum = `HOAN-COC-${order.order_number}`;
    await getDb(req).from('finance_transactions').insert([{
      transaction_number: refundNum,
      type:               'expense',
      category:           'hoan_tien',
      amount:             order.deposit_amount,
      payment_method:     order.payment_method || 'cash',
      reference_id:       orderId,
      reference_type:     'sales_order',
      description:        `Hoàn tiền cọc huỷ đơn ${order.order_number} — lý do: ${cancel_reason}`,
      transaction_date:   new Date().toISOString().split('T')[0],
    }]);
  }

  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ══════════════════════════════════════════════════════════════════════════════

// Tạo đơn hàng mới (status = draft)
const createOrder = async (req, res) => {
  try {
    const {
      customer_id, salesperson_id, items, accessories = [],
      discount_amount = 0, payment_method, deposit_amount = 0,
      delivery_date, delivery_address, notes,
      promotions = [],   // [{ promotion_id, promo_name, promo_type, discount_amount, gift_item_id, gift_item_name, gift_quantity }]
      fees = [],         // [{ fee_key, fee_label, amount }]
      services = [],     // [{ service_id, service_name, price }]
    } = req.body;

    // Tính tổng tiền xe
    let subtotal = 0;
    for (const item of items) {
      const { data: vehicle } = await getDb(req).from('vehicle_models').select('price_sell').eq('id', item.vehicle_model_id).single();
      item.unit_price = item.unit_price || vehicle?.price_sell || 0;
      item.line_total = item.unit_price * item.quantity * (1 - (item.discount_percent || 0) / 100);
      subtotal += item.line_total;
    }

    // Cộng phụ kiện — pin thuê (assignment_type='rent') không tính tiền
    const accessoriesSubtotal = accessories.reduce((sum, a) => {
      const isRent = a.assignment_type === 'rent';
      if (isRent) return sum;
      return sum + (a.unit_price * (a.quantity || 1));
    }, 0);
    subtotal += accessoriesSubtotal;

    // Validate pin: phải đủ serial khi item là battery
    const batteryCheck = await validateBatteryItems(accessories);
    if (!batteryCheck.ok) return res.status(400).json({ error: batteryCheck.error });

    // Cộng phí & dịch vụ
    const feesTotal    = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const servicesTotal = services.reduce((s, sv) => s + (Number(sv.price) || 0), 0);

    const total_amount = subtotal - discount_amount + feesTotal + servicesTotal;

    // Sinh mã đơn hàng dựa trên bản ghi mới nhất
    const { data: lastOrder } = await getDb(req).from('sales_orders')
      .select('order_number')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    if (lastOrder?.order_number) {
      const year = new Date().getFullYear();
      const prefix = `DH${year}`;
      if (lastOrder.order_number.startsWith(prefix)) {
        const num = parseInt(lastOrder.order_number.replace(prefix, ''), 10);
        if (!isNaN(num)) nextNum = num + 1;
      }
    }
    const order_number = `DH${new Date().getFullYear()}${String(nextNum).padStart(5, '0')}`;

    // Tạo đơn — status mặc định là 'draft' để sales xem lại trước khi xác nhận
    const { data: order, error: orderErr } = await getDb(req).from('sales_orders')
      .insert([{
        order_number, customer_id,
        salesperson_id: salesperson_id || req.user?.sub,
        subtotal, discount_amount, total_amount, payment_method,
        deposit_amount, delivery_date, delivery_address, notes,
        status: 'draft',
      }])
      .select()
      .single();
    if (orderErr) return res.status(400).json({ error: orderErr.message });

    // Chi tiết đơn hàng (xe)
    const orderItems = items.map(item => ({ ...item, order_id: order.id }));
    const { error: itemsErr } = await getDb(req).from('sales_order_items').insert(orderItems);
    if (itemsErr) return res.status(400).json({ error: itemsErr.message });

    // Phụ kiện đi kèm
    if (accessories.length > 0) {
      const accessoryRows = accessories.map(a => {
        const isRent = a.assignment_type === 'rent';
        return {
          order_id:        order.id,
          accessory_id:    a.accessory_id,
          quantity:        a.quantity || 1,
          unit_price:      a.unit_price,
          line_total:      isRent ? 0 : (a.unit_price * (a.quantity || 1)),
          serial_numbers:  Array.isArray(a.serial_numbers) && a.serial_numbers.length > 0
            ? a.serial_numbers.map(s => String(s).trim()).filter(Boolean)
            : null,
          assignment_type: a.assignment_type || null,
        };
      });
      const { error: accErr } = await getDb(req).from('sales_order_accessories')
        .insert(accessoryRows);
      if (accErr) console.error('⚠️ Lưu phụ kiện thất bại:', accErr.message);
    }

    // Khuyến mãi áp dụng
    if (promotions.length > 0) {
      const promoRows = promotions.map(p => ({ ...p, order_id: order.id }));
      const { error: promoErr } = await getDb(req).from('sales_order_promotions').insert(promoRows);
      if (promoErr) console.error('⚠️ Lưu khuyến mãi thất bại:', promoErr.message);
    }

    // Phí cố định
    if (fees.length > 0) {
      const feeRows = fees.map(f => ({ ...f, order_id: order.id }));
      const { error: feeErr } = await getDb(req).from('sales_order_fees').insert(feeRows);
      if (feeErr) console.error('⚠️ Lưu phí thất bại:', feeErr.message);
    }

    // Dịch vụ đăng ký
    if (services.length > 0) {
      const svcRows = services.map(s => ({ ...s, order_id: order.id }));
      const { error: svcErr } = await getDb(req).from('sales_order_services').insert(svcRows);
      if (svcErr) console.error('⚠️ Lưu dịch vụ thất bại:', svcErr.message);
    }

    // Đặt trước xe (reserved) — chưa bán hẳn, chờ confirmed
    for (const item of items) {
      if (item.inventory_vehicle_id) {
        await getDb(req).from('inventory_vehicles')
          .update({ status: 'reserved' })
          .eq('id', item.inventory_vehicle_id);
      }
    }

    res.status(201).json({ message: 'Tạo đơn hàng thành công', order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// CẬP NHẬT ĐƠN HÀNG — chỉ cho phép khi đơn đang ở trạng thái 'draft' (Mở)
// ══════════════════════════════════════════════════════════════════════════════
const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_id, items, accessories = [],
      discount_amount = 0, payment_method, deposit_amount = 0,
      delivery_date, delivery_address, notes,
      promotions = [], fees = [], services = [],
    } = req.body;

    // Lấy đơn hiện tại
    const { data: existing, error: fetchErr } = await getDb(req).from('sales_orders').select('*').eq('id', id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    if (existing.status !== 'draft') {
      return res.status(409).json({
        error: `Chỉ sửa được đơn ở trạng thái "Mở". Trạng thái hiện tại: "${existing.status}".`,
      });
    }

    // Trả các xe đang reserved của đơn cũ về in_stock trước khi ghi items mới
    const { data: oldItems } = await getDb(req).from('sales_order_items')
      .select('inventory_vehicle_id')
      .eq('order_id', id);
    for (const it of oldItems || []) {
      if (it.inventory_vehicle_id) {
        await getDb(req).from('inventory_vehicles')
          .update({ status: 'in_stock' })
          .eq('id', it.inventory_vehicle_id);
      }
    }

    // Tính lại tổng tiền theo dữ liệu mới
    let subtotal = 0;
    for (const item of items) {
      const { data: vehicle } = await getDb(req).from('vehicle_models').select('price_sell').eq('id', item.vehicle_model_id).single();
      item.unit_price = item.unit_price || vehicle?.price_sell || 0;
      item.line_total = item.unit_price * item.quantity * (1 - (item.discount_percent || 0) / 100);
      subtotal += item.line_total;
    }
    // Pin thuê không cộng vào subtotal
    const accessoriesSubtotal = accessories.reduce((sum, a) => {
      const isRent = a.assignment_type === 'rent';
      if (isRent) return sum;
      return sum + (a.unit_price * (a.quantity || 1));
    }, 0);
    subtotal += accessoriesSubtotal;

    // Validate pin
    const batteryCheckUpd = await validateBatteryItems(accessories);
    if (!batteryCheckUpd.ok) return res.status(400).json({ error: batteryCheckUpd.error });

    const feesTotal     = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const servicesTotal = services.reduce((s, sv) => s + (Number(sv.price) || 0), 0);
    const total_amount  = subtotal - discount_amount + feesTotal + servicesTotal;

    // Cập nhật đơn — giữ order_number, status, salesperson_id
    const { data: updated, error: updErr } = await getDb(req).from('sales_orders')
      .update({
        customer_id, subtotal, discount_amount, total_amount,
        payment_method, deposit_amount,
        delivery_date: delivery_date || null,
        delivery_address: delivery_address || null,
        notes: notes || null,
      })
      .eq('id', id)
      .select()
      .single();
    if (updErr) return res.status(400).json({ error: updErr.message });

    // Xoá toàn bộ chi tiết cũ rồi insert lại — đơn giản và an toàn vì status='draft'
    await getDb(req).from('sales_order_items').delete().eq('order_id', id);
    await getDb(req).from('sales_order_accessories').delete().eq('order_id', id);
    await getDb(req).from('sales_order_promotions').delete().eq('order_id', id);
    await getDb(req).from('sales_order_fees').delete().eq('order_id', id);
    await getDb(req).from('sales_order_services').delete().eq('order_id', id);

    // Items
    const itemRows = items.map(it => ({ ...it, order_id: id }));
    const { error: itemsErr } = await getDb(req).from('sales_order_items').insert(itemRows);
    if (itemsErr) return res.status(400).json({ error: itemsErr.message });

    if (accessories.length > 0) {
      const accRows = accessories.map(a => {
        const isRent = a.assignment_type === 'rent';
        return {
          order_id:        id,
          accessory_id:    a.accessory_id,
          quantity:        a.quantity || 1,
          unit_price:      a.unit_price,
          line_total:      isRent ? 0 : (a.unit_price * (a.quantity || 1)),
          serial_numbers:  Array.isArray(a.serial_numbers) && a.serial_numbers.length > 0
            ? a.serial_numbers.map(s => String(s).trim()).filter(Boolean)
            : null,
          assignment_type: a.assignment_type || null,
        };
      });
      const { error: e } = await getDb(req).from('sales_order_accessories').insert(accRows);
      if (e) console.error('⚠️ Lưu phụ kiện thất bại:', e.message);
    }
    if (promotions.length > 0) {
      const rows = promotions.map(p => ({ ...p, order_id: id }));
      const { error: e } = await getDb(req).from('sales_order_promotions').insert(rows);
      if (e) console.error('⚠️ Lưu khuyến mãi thất bại:', e.message);
    }
    if (fees.length > 0) {
      const rows = fees.map(f => ({ ...f, order_id: id }));
      const { error: e } = await getDb(req).from('sales_order_fees').insert(rows);
      if (e) console.error('⚠️ Lưu phí thất bại:', e.message);
    }
    if (services.length > 0) {
      const rows = services.map(s => ({ ...s, order_id: id }));
      const { error: e } = await getDb(req).from('sales_order_services').insert(rows);
      if (e) console.error('⚠️ Lưu dịch vụ thất bại:', e.message);
    }

    // Reserve xe mới (nếu có VIN)
    for (const item of items) {
      if (item.inventory_vehicle_id) {
        await getDb(req).from('inventory_vehicles')
          .update({ status: 'reserved' })
          .eq('id', item.inventory_vehicle_id);
      }
    }

    return res.json({ message: 'Cập nhật đơn hàng thành công', order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Danh sách đơn hàng
const getOrders = async (req, res) => {
  try {
    const { status, from_date, to_date, page = 1, limit = 20 } = req.query;
    let query = getDb(req).from('sales_orders')
      .select(`
        *,
        customers(full_name, phone),
        users!salesperson_id(full_name),
        sales_order_items(
          quantity,
          vehicle_models(brand, model_name),
          inventory_vehicles(vin, color)
        )
      `, { count: 'exact' })
      .order('order_date', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) query = query.eq('status', status);
    if (from_date) query = query.gte('order_date', from_date);
    if (to_date) query = query.lte('order_date', to_date);

    // Sales chỉ xem đơn của mình
    if (req.user?.role === 'sales') {
      query = query.eq('salesperson_id', req.user.sub);
    }

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết đơn hàng
const getOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // Query cơ bản — luôn hoạt động dù chưa có bảng extras
    const { data, error } = await getDb(req).from('sales_orders')
      .select(`
        *,
        customers(id, customer_code, full_name, phone, email, address),
        users!salesperson_id(full_name, phone),
        approved_by_user:users!approved_by(full_name),
        technician:users!technician_id(full_name),
        sales_order_items(
          *,
          inventory_vehicles(vin, color, engine_number),
          vehicle_models(brand, model_name, image_url, warranty_months)
        ),
        sales_order_accessories(*, accessories(id, code, name, category, image_url, unit, price_sell))
      `)
      .eq('id', id)
      .single();

    if (error) {
      const status = error.code === 'PGRST116' ? 404 : 400;
      return res.status(status).json({ error: 'Không tìm thấy đơn hàng', detail: error.message });
    }

    // Sales chỉ xem được đơn của mình
    if (req.user?.role === 'sales' && data.salesperson_id !== req.user.sub) {
      return res.status(403).json({ error: 'Bạn không có quyền xem đơn hàng này' });
    }

    // Query bảng extras — graceful fallback nếu migration chưa chạy
    const [promoRes, feeRes, svcRes, paymentRes, settingsRes] = await Promise.all([
      getDb(req).from('sales_order_promotions').select('*').eq('order_id', id),
      getDb(req).from('sales_order_fees').select('*').eq('order_id', id),
      getDb(req).from('sales_order_services').select('*').eq('order_id', id),
      getDb(req).from('sales_order_payments')
        .select('id, payment_method, amount, payment_date, status, receipt_number, bank_reference, sepay_transaction_id, confirmed_at, confirmed_by_user:confirmed_by(full_name)')
        .eq('order_id', id)
        .order('created_at', { ascending: true }),
      getDb(req).from('app_settings')
        .select('value')
        .eq('key', 'company')
        .maybeSingle(),
    ]);

    data.sales_order_promotions = promoRes.error    ? [] : (promoRes.data    ?? []);
    data.sales_order_fees       = feeRes.error      ? [] : (feeRes.data      ?? []);
    data.sales_order_services   = svcRes.error      ? [] : (svcRes.data      ?? []);
    data.payments               = paymentRes.error  ? [] : (paymentRes.data  ?? []);
    data.company                = settingsRes.error ? {} : (settingsRes.data?.value ?? {});

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật trạng thái đơn hàng — state machine có phân quyền
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: toStatus, ...extraFields } = req.body;
    const userRole = req.user?.role;

    // Lấy đơn hiện tại
    const { data: order, error: fetchErr } = await getDb(req).from('sales_orders')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    const fromStatus = order.status;

    // Kiểm tra transition hợp lệ
    if (!canTransition(fromStatus, toStatus, userRole)) {
      if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
        return res.status(409).json({
          error: `Không thể chuyển từ trạng thái "${fromStatus}" sang "${toStatus}"`,
        });
      }
      return res.status(403).json({
        error: `Vai trò "${userRole}" không có quyền thực hiện thao tác này`,
      });
    }

    // Gọi handler tương ứng
    let result;

    // ── REOPEN: chuyển về draft từ bất kỳ trạng thái nào (chỉ admin/manager) ──
    if (toStatus === 'draft' && fromStatus !== 'draft') {
      const { data: reopened, error: reopenErr } = await getDb(req).from('sales_orders')
        .update({ status: 'draft' })
        .eq('id', id)
        .select()
        .single();
      if (reopenErr) return res.status(400).json({ error: reopenErr.message });

      // Trả xe về reserved nếu trước đó đã sold/warranty_repair
      const { data: items } = await getDb(req).from('sales_order_items')
        .select('inventory_vehicle_id')
        .eq('order_id', id);
      for (const item of items || []) {
        if (!item.inventory_vehicle_id) continue;
        const { data: veh } = await getDb(req).from('inventory_vehicles')
          .select('status')
          .eq('id', item.inventory_vehicle_id)
          .single();
        // Chỉ chỉnh nếu xe ở trạng thái sold/warranty_repair (do đơn này gây ra)
        if (veh && ['sold', 'warranty_repair'].includes(veh.status)) {
          await getDb(req).from('inventory_vehicles')
            .update({ status: 'reserved' })
            .eq('id', item.inventory_vehicle_id);
        }
      }

      // Lưu ý: sales_order_payments + deposit_amount + receipt_number GIỮ NGUYÊN
      console.log(`[reopen] Đơn ${order.order_number}: ${fromStatus} → draft (giữ nguyên thanh toán)`);
      return res.json({ message: 'Đã mở lại đơn hàng', order: reopened });
    }

    switch (toStatus) {
      case 'confirmed':
        result = await handleConfirm(id);
        // Cập nhật xe từ reserved → reserved (giữ nguyên, confirmed mới chắc chắn)
        break;

      case 'deposit_paid':
        if (!extraFields.deposit_amount) {
          return res.status(400).json({ error: 'Thiếu số tiền cọc' });
        }
        if (extraFields.deposit_amount > order.total_amount) {
          return res.status(400).json({ error: 'Số tiền cọc không được vượt quá tổng đơn hàng' });
        }
        result = await handleDepositPaid(id, extraFields.deposit_amount, order.deposit_amount);
        break;

      case 'full_paid':
        result = await handleFullPaid(id, {
          receipt_number: extraFields.receipt_number,
          receipt_date:   extraFields.receipt_date,
          payment_note:   extraFields.payment_note,
        }, order);
        // Cập nhật xe từ reserved → sold
        {
          const { data: items } = await getDb(req).from('sales_order_items')
            .select('inventory_vehicle_id')
            .eq('order_id', id);
          for (const item of items || []) {
            if (item.inventory_vehicle_id) {
              await getDb(req).from('inventory_vehicles')
                .update({ status: 'sold' })
                .eq('id', item.inventory_vehicle_id);
            }
          }
        }
        break;

      case 'invoice_requested':
        result = await handleInvoiceRequested(id);
        break;

      case 'invoice_approved':
        // Tự động chuyển thẳng sang pdi_pending
        result = await handleInvoiceApproved(id, req.user?.sub);
        break;

      case 'pdi_done':
        if (!extraFields.pdi_notes?.trim() || extraFields.pdi_notes.trim().length < 5) {
          return res.status(400).json({ error: 'Ghi chú PDI tối thiểu 5 ký tự' });
        }
        result = await handlePdiDone(id, extraFields.pdi_notes.trim(), req.user?.sub);
        break;

      case 'delivered':
        result = await handleDeliver(id, order.delivery_date);
        break;

      case 'cancelled':
        if (!extraFields.cancel_reason?.trim()) {
          return res.status(400).json({ error: 'Thiếu lý do huỷ đơn' });
        }
        result = await handleCancel(id, extraFields.cancel_reason.trim(), order);
        // Trả xe về kho nếu chưa giao
        {
          const { data: items } = await getDb(req).from('sales_order_items')
            .select('inventory_vehicle_id')
            .eq('order_id', id);
          for (const item of items || []) {
            if (item.inventory_vehicle_id) {
              await getDb(req).from('inventory_vehicles')
                .update({ status: 'in_stock' })
                .eq('id', item.inventory_vehicle_id);
            }
          }
        }
        break;

      default:
        return res.status(400).json({ error: 'Trạng thái không xác định' });
    }

    res.json({ message: 'Cập nhật trạng thái thành công', order: result });
  } catch (err) {
    const httpStatus = err.status || 500;
    res.status(httpStatus).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// CẬP NHẬT MÃ DMS CHO ĐƠN HÀNG — chỉ admin/manager/accountant
// ══════════════════════════════════════════════════════════════════════════════
const updateDmsCode = async (req, res) => {
  try {
    const { id } = req.params;
    const { dms_order_number } = req.body;

    if (dms_order_number != null && typeof dms_order_number !== 'string') {
      return res.status(400).json({ error: 'Mã DMS không hợp lệ' });
    }

    const value = dms_order_number ? String(dms_order_number).trim() : null;

    const { data, error } = await getDb(req).from('sales_orders')
      .update({ dms_order_number: value })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật mã DMS', order: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { createOrder, updateOrder, getOrders, getOrderDetail, updateOrderStatus, updateDmsCode };
