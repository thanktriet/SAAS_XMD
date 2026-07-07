const { supabaseAdmin } = require('./config/supabase');
const { generateCode } = require('./codeGenerator');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { awardLoyaltyPoints } = require('./loyalty.service');
const { validateBatteryItems, createAssignments, isBatteryAccessory } = require('./battery.service');

// ─── Sinh mã đơn — có prefix chi nhánh: CN01-PK202600001 ──────────────────────
async function generateOrderCode(req) {
  return generateCode(req, {
    table: 'accessory_orders', column: 'order_code',
    prefix: 'PK', padLength: 5, yearInPrefix: true,
  });
}

// ─── Lấy userId helper ────────────────────────────────────────────────────────
const userId = (req) => req.user?.sub || null;

// ─── Danh sách đơn ────────────────────────────────────────────────────────────
const getAccessoryOrders = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    let q = getDb(req).from('accessory_orders')
      .select(`
        *,
        users!created_by(full_name),
        customers(full_name, phone, loyalty_points),
        accessory_order_items(*, accessories(name, code, unit))
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) q = q.eq('payment_status', status);
    if (search) {
      const s = String(search).trim();
      q = q.or(`order_code.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`);
    }

    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết ─────────────────────────────────────────────────────────────────
const getAccessoryOrderById = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('accessory_orders')
      .select(`
        *,
        users!created_by(full_name),
        customers(full_name, phone, loyalty_points, address),
        accessory_order_items(*, accessories(name, code, unit, image_url))
      `)
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo đơn — bắt buộc KH + ít nhất 1 item ───────────────────────────────────
const createAccessoryOrder = async (req, res) => {
  try {
    const { customer_id, items, payment_method, notes } = req.body;

    if (!customer_id) return res.status(400).json({ error: 'Phải gắn KH cho đơn' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Đơn phải có ít nhất 1 phụ kiện' });
    }
    const pm = payment_method || 'qr_sepay';
    if (!['qr_sepay', 'cash'].includes(pm)) {
      return res.status(400).json({ error: 'Phương thức thanh toán không hợp lệ' });
    }

    // Verify KH
    const { data: cust, error: custErr } = await getDb(req).from('customers')
      .select('id, full_name, phone')
      .eq('id', customer_id)
      .single();
    if (custErr || !cust) return res.status(404).json({ error: 'Không tìm thấy KH' });

    // Verify từng phụ kiện + check tồn kho
    const accIds = items.map(i => i.accessory_id);
    const { data: accs, error: accErr } = await getDb(req).from('accessories')
      .select('id, name, qty_in_stock, price_sell, is_active, category')
      .in('id', accIds);
    if (accErr) return res.status(400).json({ error: accErr.message });
    if (!accs || accs.length !== accIds.length) {
      return res.status(400).json({ error: 'Có phụ kiện không tồn tại' });
    }

    // Validate items + battery serial
    const batteryCheck = await validateBatteryItems(items);
    if (!batteryCheck.ok) return res.status(400).json({ error: batteryCheck.error });

    let subtotal = 0;
    const itemRows = [];
    for (const it of items) {
      const acc = accs.find(a => a.id === it.accessory_id);
      if (!acc) return res.status(400).json({ error: `Phụ kiện ${it.accessory_id} không tồn tại` });
      if (!acc.is_active) return res.status(400).json({ error: `Phụ kiện "${acc.name}" đã ngừng kinh doanh` });

      const qty = Number(it.quantity);
      if (!qty || qty <= 0) return res.status(400).json({ error: `Số lượng "${acc.name}" phải > 0` });
      if (qty > acc.qty_in_stock) {
        return res.status(400).json({ error: `Không đủ tồn: "${acc.name}" còn ${acc.qty_in_stock}, cần ${qty}` });
      }

      const unitPrice = Number(it.unit_price ?? acc.price_sell);
      const isBattery = acc.category === 'battery';
      const isRent    = isBattery && it.assignment_type === 'rent';
      // Pin thuê: line_total = 0 (đại lý không thu)
      const lineTotal = isRent ? 0 : unitPrice * qty;
      subtotal += lineTotal;

      itemRows.push({
        accessory_id:    acc.id,
        quantity:        qty,
        unit_price:      unitPrice,
        line_total:      lineTotal,
        serial_numbers:  isBattery
          ? (it.serial_numbers ?? []).map(s => String(s).trim()).filter(Boolean)
          : null,
        assignment_type: isBattery ? it.assignment_type : null,
      });
    }

    const order_code = await generateOrderCode(req);

    // Tạo đơn (status = pending — chưa giảm tồn kho cho đến khi paid)
    const { data: order, error: orderErr } = await getDb(req).from('accessory_orders')
      .insert([{
        order_code,
        customer_id:    cust.id,
        customer_name:  cust.full_name,
        customer_phone: cust.phone,
        subtotal,
        total_amount:   subtotal,
        payment_method: pm,
        notes:          notes?.trim() || null,
        created_by:     userId(req),
      }])
      .select()
      .single();
    if (orderErr) return res.status(400).json({ error: orderErr.message });

    // Insert items
    const itemsToInsert = itemRows.map(r => ({ ...r, order_id: order.id }));
    const { error: itemErr } = await getDb(req).from('accessory_order_items')
      .insert(itemsToInsert);
    if (itemErr) {
      // Rollback đơn nếu insert items thất bại
      await getDb(req).from('accessory_orders').delete().eq('id', order.id);
      return res.status(400).json({ error: `Lưu items thất bại: ${itemErr.message}` });
    }

    // Trả về đơn đầy đủ
    const { data: full } = await getDb(req).from('accessory_orders')
      .select(`
        *,
        users!created_by(full_name),
        customers(full_name, phone, loyalty_points),
        accessory_order_items(*, accessories(name, code, unit))
      `)
      .eq('id', order.id)
      .single();

    res.status(201).json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Hoàn tất khi đơn paid: giảm tồn + cộng điểm + ghi finance + gắn pin ───────
async function processPaidOrder(orderId, { method, sepayId, paidByUserId }) {
  const { data: order, error: fetchErr } = await getDb(req).from('accessory_orders')
    .select(`
      id, order_code, customer_id, total_amount, payment_status,
      accessory_order_items(accessory_id, quantity, unit_price, serial_numbers, assignment_type)
    `)
    .eq('id', orderId)
    .single();
  if (fetchErr || !order) throw new Error('Không tìm thấy đơn');
  if (order.payment_status !== 'pending') return order; // idempotent

  // Ghi item_movements (xuất kho) — cả pin mua + pin thuê đều giảm tồn
  const movements = (order.accessory_order_items || []).map(it => ({
    item_type:      'accessory',
    item_id:        it.accessory_id,
    movement_type:  'export',
    quantity:       it.quantity,
    reference_type: 'accessory_order',
    reference_id:   orderId,
    note:           `Bán đơn ${order.order_code}${it.assignment_type === 'rent' ? ' (pin thuê)' : ''}`,
    created_by:     paidByUserId || null,
  }));
  if (movements.length > 0) {
    const { error: mvErr } = await getDb(req).from('item_movements').insert(movements);
    if (mvErr) console.error(`[acc-order] xuất kho thất bại: ${mvErr.message}`);
  }

  // Tạo battery_assignments cho serial pin
  try {
    await createAssignments({
      items:        order.accessory_order_items || [],
      customerId:   order.customer_id,
      sourceType:   'accessory_order',
      sourceId:     orderId,
      createdBy:    paidByUserId || null,
    });
  } catch (e) {
    console.error('[acc-order] gắn pin thất bại:', e.message);
  }

  // Ghi finance_transaction
  const txnNumber = method === 'cash'
    ? `PK-CASH-${order.order_code}`
    : `SEPAY-${sepayId}`;

  const { data: ft, error: ftErr } = await getDb(req).from('finance_transactions')
    .insert({
      transaction_number: txnNumber,
      type:               'income',
      category:           'ban_hang',
      amount:             Number(order.total_amount),
      payment_method:     method === 'cash' ? 'cash' : 'qr_code',
      reference_id:       orderId,
      reference_type:     'accessory_order',
      description:        `Thu tiền đơn phụ kiện ${order.order_code}`,
      transaction_date:   new Date().toISOString().split('T')[0],
      sepay_transaction_id: sepayId ?? null,
      created_by:         paidByUserId || null,
    })
    .select('id')
    .single();
  if (ftErr && ftErr.code !== '23505') {
    console.error(`[acc-order] lưu finance thất bại: ${ftErr.message}`);
  }

  // Cập nhật đơn → paid
  const { data: updated, error: updErr } = await getDb(req).from('accessory_orders')
    .update({
      payment_status:         'paid',
      finance_transaction_id: ft?.id ?? null,
      sepay_transaction_id:   sepayId ? String(sepayId) : null,
      paid_by:                paidByUserId || null,
      paid_at:                new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();
  if (updErr) throw new Error(updErr.message);

  // Cộng điểm
  if (order.customer_id) {
    await awardLoyaltyPoints(order.customer_id, order.total_amount, `accessory_order:${order.order_code}`);
  }

  return updated;
}

// ─── Xác nhận thu tiền mặt ────────────────────────────────────────────────────
const confirmCashPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order } = await getDb(req).from('accessory_orders')
      .select('id, payment_method, payment_status')
      .eq('id', id)
      .single();
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (order.payment_method !== 'cash') {
      return res.status(409).json({ error: 'Đơn này không phải thanh toán tiền mặt' });
    }
    if (order.payment_status !== 'pending') {
      return res.status(409).json({ error: `Đơn đang ở trạng thái "${order.payment_status}"` });
    }

    const updated = await processPaidOrder(id, {
      method:       'cash',
      paidByUserId: userId(req),
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Hủy đơn ──────────────────────────────────────────────────────────────────
const cancelAccessoryOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur } = await getDb(req).from('accessory_orders').select('payment_status').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (cur.payment_status === 'paid') {
      return res.status(409).json({ error: 'Đơn đã thanh toán, không thể hủy' });
    }

    const { data, error } = await getDb(req).from('accessory_orders')
      .update({ payment_status: 'cancelled' })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAccessoryOrders,
  getAccessoryOrderById,
  createAccessoryOrder,
  confirmCashPayment,
  cancelAccessoryOrder,
  processPaidOrder, // expose cho webhook
};
