// Controller: Thanh toán đơn hàng (sales_order_payments)
const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// ════════════════════════════════════════════════════════════════
//  HELPER: tính tổng đã thu (confirmed) và cập nhật status đơn
// ════════════════════════════════════════════════════════════════
async function recalcOrderStatus(orderId) {
  // Tổng đã xác nhận
  const { data: rows } = await getDb(req).from('sales_order_payments')
    .select('amount')
    .eq('order_id', orderId)
    .eq('status', 'confirmed');

  const totalPaid = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);

  // Lấy thông tin đơn
  const { data: order } = await getDb(req).from('sales_orders')
    .select('id, total_amount, status')
    .eq('id', orderId)
    .single();

  if (!order) return;

  const remaining   = Number(order.total_amount) - totalPaid;
  const doneStatuses = ['pdi_pending', 'pdi_done', 'delivered', 'cancelled',
                        'invoice_requested', 'invoice_approved'];

  let newStatus = order.status;

  if (remaining <= 0 && !doneStatuses.includes(order.status)) {
    newStatus = 'full_paid';
  } else if (remaining > 0 && totalPaid > 0
    && ['draft', 'confirmed'].includes(order.status)) {
    newStatus = 'deposit_paid';
  }

  // Cập nhật deposit_amount (denormalized) để backward compat
  await getDb(req).from('sales_orders')
    .update({ status: newStatus, deposit_amount: totalPaid })
    .eq('id', orderId);

  return { totalPaid, remaining, newStatus };
}

// ════════════════════════════════════════════════════════════════
//  GET /api/sales/:id/payments
//  Lấy danh sách thanh toán + summary
// ════════════════════════════════════════════════════════════════
const getPayments = async (req, res) => {
  try {
    const { id: orderId } = req.params;

    // Kiểm tra đơn tồn tại
    const { data: order, error: oErr } = await getDb(req).from('sales_orders')
      .select('id, order_number, total_amount, status')
      .eq('id', orderId)
      .single();

    if (oErr || !order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    // Lấy danh sách payment — bao gồm cả cancelled để giữ audit trail
    const { data: payments, error: pErr } = await getDb(req).from('sales_order_payments')
      .select(`
        id, payment_method, amount, payment_date, status, notes,
        receipt_number, bank_reference, transfer_screenshot_url,
        sepay_transaction_id, finance_transaction_id,
        created_at, confirmed_at,
        created_by_user:created_by ( id, full_name ),
        confirmed_by_user:confirmed_by ( id, full_name )
      `)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (pErr) {
      console.error('[getPayments] Supabase error:', pErr);
      throw new Error(pErr.message);
    }

    // Tính summary
    const totalPaid    = (payments ?? [])
      .filter(p => p.status === 'confirmed')
      .reduce((s, p) => s + Number(p.amount), 0);
    const totalPending = (payments ?? [])
      .filter(p => p.status === 'pending')
      .reduce((s, p) => s + Number(p.amount), 0);
    const remaining    = Number(order.total_amount) - totalPaid;

    res.json({
      payments: payments ?? [],
      summary: {
        total_amount:  Number(order.total_amount),
        total_paid:    totalPaid,
        total_pending: totalPending,
        remaining:     Math.max(0, remaining),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  POST /api/sales/:id/payments
//  TVBH tạo payment record (status = pending)
//  QR Code do webhook SEPay gọi riêng — endpoint này chỉ cho
//  cash và bank_transfer
// ════════════════════════════════════════════════════════════════
const createPayment = async (req, res) => {
  try {
    const { id: orderId }   = req.params;
    const userId            = req.user?.id;
    const {
      payment_method,
      amount,
      payment_date,
      transfer_screenshot_url,
      notes,
    } = req.body;

    // Không cho tạo qr_code thủ công — do webhook xử lý
    if (payment_method === 'qr_code') {
      return res.status(400).json({
        error: 'Thanh toán QR được xử lý tự động bởi SEPay. Vui lòng để khách quét mã.',
      });
    }

    // Kiểm tra đơn tồn tại và chưa huỷ
    const { data: order, error: oErr } = await getDb(req).from('sales_orders')
      .select('id, order_number, total_amount, status')
      .eq('id', orderId)
      .single();

    if (oErr || !order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (order.status === 'cancelled') {
      return res.status(422).json({ error: 'Đơn hàng đã bị huỷ' });
    }
    if (['delivered'].includes(order.status)) {
      return res.status(422).json({ error: 'Đơn hàng đã hoàn tất giao xe' });
    }

    // Kiểm tra số tiền không vượt quá công nợ còn lại
    const { data: existingRows } = await getDb(req).from('sales_order_payments')
      .select('amount')
      .eq('order_id', orderId)
      .eq('status', 'confirmed');

    const totalConfirmed = (existingRows ?? []).reduce((s, r) => s + Number(r.amount), 0);
    const remaining      = Number(order.total_amount) - totalConfirmed;

    if (Number(amount) > remaining + 1) { // +1 để tránh floating point
      return res.status(422).json({
        error: `Số tiền vượt quá công nợ còn lại (${remaining.toLocaleString('vi-VN')} ₫)`,
      });
    }

    // Tạo payment record (pending — chờ kế toán xác nhận)
    const { data: payment, error: insertErr } = await getDb(req).from('sales_order_payments')
      .insert({
        order_id:               orderId,
        payment_method,
        amount:                 Number(amount),
        payment_date,
        status:                 'pending',
        transfer_screenshot_url: transfer_screenshot_url ?? null,
        notes:                  notes ?? null,
        created_by:             userId ?? null,
      })
      .select()
      .single();

    if (insertErr) throw new Error(insertErr.message);

    res.status(201).json({ payment, message: 'Đã ghi nhận — chờ kế toán xác nhận' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  PATCH /api/sales/:id/payments/:paymentId/confirm
//  Kế toán xác nhận + nhập số bút toán / phiếu thu
// ════════════════════════════════════════════════════════════════
const confirmPayment = async (req, res) => {
  try {
    const { id: orderId, paymentId } = req.params;
    const userId = req.user?.id;
    const { receipt_number, bank_reference, notes } = req.body;

    // Lấy payment
    const { data: payment, error: pErr } = await getDb(req).from('sales_order_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('order_id', orderId)
      .single();

    if (pErr || !payment) return res.status(404).json({ error: 'Không tìm thấy bản ghi thanh toán' });
    if (payment.status !== 'pending') {
      return res.status(422).json({ error: `Thanh toán này đang ở trạng thái "${payment.status}", không thể xác nhận` });
    }

    // Kiểm tra receipt_number không trùng (nếu có truyền lên)
    if (receipt_number?.trim()) {
      const { data: dup } = await getDb(req).from('sales_order_payments')
        .select('id')
        .eq('receipt_number', receipt_number.trim())
        .neq('id', paymentId)
        .neq('status', 'cancelled')
        .maybeSingle();
      if (dup) return res.status(422).json({ error: 'Số phiếu thu đã tồn tại trong hệ thống' });
    }

    // Cập nhật payment → confirmed
    const { data: updated, error: upErr } = await getDb(req).from('sales_order_payments')
      .update({
        status:          'confirmed',
        receipt_number:  receipt_number?.trim() ?? null,
        bank_reference:  bank_reference?.trim() ?? null,
        notes:           notes?.trim() ?? payment.notes,
        confirmed_by:    userId ?? null,
        confirmed_at:    new Date().toISOString(),
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (upErr) throw new Error(upErr.message);

    // Lấy order number để ghi vào description finance
    const { data: orderInfo } = await getDb(req).from('sales_orders')
      .select('order_number')
      .eq('id', orderId)
      .single();
    const orderNumber = orderInfo?.order_number ?? orderId;

    // Sinh finance_transaction — description kèm mã đơn để dễ tra cứu
    const txnNumber = receipt_number?.trim()
      ?? bank_reference?.trim()
      ?? `PAY-${paymentId.slice(-6).toUpperCase()}`;

    const methodLabel = {
      cash:          'Tiền mặt',
      bank_transfer: 'Chuyển khoản',
      qr_code:       'QR SEPay',
    }[payment.payment_method] ?? payment.payment_method;

    const { data: ftRow, error: ftErr } = await getDb(req).from('finance_transactions')
      .insert({
        transaction_number:  txnNumber,
        type:                'income',
        category:            'ban_hang',
        amount:              Number(payment.amount),
        payment_method:      payment.payment_method,
        reference_id:        orderId,
        reference_type:      'sales_order',
        description:         `Thu tiền đơn ${orderNumber} — ${methodLabel}`,
        transaction_date:    payment.payment_date,
        notes:               notes?.trim() ?? null,
        created_by:          userId ?? null,
      })
      .select('id')
      .single();

    if (ftErr) throw new Error(`Ghi finance_transaction thất bại: ${ftErr.message}`);

    // Liên kết ngược: cập nhật finance_transaction_id vào sales_order_payments
    await getDb(req).from('sales_order_payments')
      .update({ finance_transaction_id: ftRow.id })
      .eq('id', paymentId);

    // Tự động cập nhật status đơn hàng
    const { totalPaid, remaining, newStatus } = await recalcOrderStatus(orderId);

    res.json({
      payment: updated,
      order_status: newStatus,
      summary: { total_paid: totalPaid, remaining },
      message: 'Đã xác nhận thanh toán',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════
//  DELETE /api/sales/:id/payments/:paymentId
//  Kế toán / Manager huỷ một lần thanh toán
// ════════════════════════════════════════════════════════════════
const cancelPayment = async (req, res) => {
  try {
    const { id: orderId, paymentId } = req.params;

    const { data: payment, error: pErr } = await getDb(req).from('sales_order_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('order_id', orderId)
      .single();

    if (pErr || !payment) return res.status(404).json({ error: 'Không tìm thấy bản ghi thanh toán' });
    if (payment.status === 'cancelled') {
      return res.status(422).json({ error: 'Thanh toán này đã bị huỷ rồi' });
    }
    if (payment.payment_method === 'qr_code') {
      return res.status(422).json({ error: 'Không thể huỷ thanh toán SEPay — liên hệ kế toán trưởng' });
    }

    // Nếu payment đã confirmed → phải tạo bút toán đảo ngược trong finance trước khi huỷ
    if (payment.status === 'confirmed') {
      const { data: orderInfo } = await getDb(req).from('sales_orders')
        .select('order_number')
        .eq('id', orderId)
        .single();
      const orderNumber = orderInfo?.order_number ?? orderId;

      const reverseNumber = `REV-${payment.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const methodLabel = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản' }[payment.payment_method] ?? payment.payment_method;

      const { error: revErr } = await getDb(req).from('finance_transactions')
        .insert({
          transaction_number: reverseNumber,
          type:               'expense',       // đảo chiều: hoàn trả / điều chỉnh
          category:           'dieu_chinh',
          amount:             Number(payment.amount),
          payment_method:     payment.payment_method,
          reference_id:       orderId,
          reference_type:     'sales_order',
          description:        `Huỷ thanh toán đơn ${orderNumber} — ${methodLabel}`,
          transaction_date:   new Date().toISOString().split('T')[0],
          notes:              `Đảo ngược bút toán ${payment.finance_transaction_id ?? 'N/A'}`,
          created_by:         req.user?.id ?? null,
        });

      if (revErr) throw new Error(`Tạo bút toán đảo ngược thất bại: ${revErr.message}`);
    }

    await getDb(req).from('sales_order_payments')
      .update({ status: 'cancelled' })
      .eq('id', paymentId);

    // Cập nhật lại status đơn
    await recalcOrderStatus(orderId);

    res.json({ message: 'Đã huỷ thanh toán' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ════════════════════════════════════════════════════════════════
//  GET /api/finance/pending-payments
//  Tất cả payment đang chờ xác nhận — dùng cho kế toán
// ════════════════════════════════════════════════════════════════
const getPendingAll = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const { method, search } = req.query;

    let q = getDb(req).from('sales_order_payments')
      .select(`
        id, order_id, amount, payment_method, payment_date,
        notes, transfer_screenshot_url, created_at,
        sales_orders!inner(
          id, order_number, total_amount, status,
          customers(id, full_name, phone)
        )
      `, { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (method)  q = q.eq('payment_method', method);
    if (search)  q = q.ilike('sales_orders.order_number', `%${search}%`);

    const { data, error, count } = await q
      .range((page - 1) * limit, page * limit - 1);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data: data ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getPayments, createPayment, confirmPayment, cancelPayment,
  getPendingAll,
  recalcOrderStatus,
};
