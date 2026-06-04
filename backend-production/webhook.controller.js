const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { recalcOrderStatus } = require('./payment.controller');
const { awardLoyaltyPoints } = require('./loyalty.service');
const { processPaidOrder: processPaidAccessoryOrder } = require('./accessoryOrder.controller');

// ══════════════════════════════════════════════════════════════════
//  POST /api/webhooks/sepay
//  SEPay gọi endpoint này mỗi khi phát hiện giao dịch ngân hàng mới
//  Tài liệu: https://developer.sepay.vn/vi/sepay-webhooks/lap-trinh-webhooks/lap-trinh-webhook-nodejs
// ══════════════════════════════════════════════════════════════════

const handleSepayWebhook = async (req, res) => {
  // 1. Xác thực API Key (theo docs chính thức)
  const apiKey = req.headers['authorization'];
  if (process.env.SEPAY_API_KEY && apiKey !== `Apikey ${process.env.SEPAY_API_KEY}`) {
    console.error('[SEPay] Webhook từ chối — sai API Key');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const data = req.body;

  // 2. Validate payload
  if (!data || !data.gateway) {
    return res.status(400).json({ success: false, message: 'No data' });
  }

  // 3. Tính amount_in / amount_out (theo cấu trúc tài liệu chính thức)
  const amountIn  = data.transferType === 'in'  ? Number(data.transferAmount) : 0;
  const amountOut = data.transferType === 'out' ? Number(data.transferAmount) : 0;

  try {
    // 4. Chống trùng lặp — kiểm tra id SEPay đã có trong finance_transactions chưa
    //    Luôn kiểm tra dù data.id có hay không (dùng transaction_number fallback)
    if (data.id) {
      const { data: dup } = await getDb(req).from('finance_transactions')
        .select('id')
        .eq('sepay_transaction_id', data.id)
        .maybeSingle();
      if (dup) {
        console.log(`[SEPay] id=${data.id} đã có trong finance_transactions — bỏ qua`);
        return res.status(200).json({ success: true });
      }
    }

    // 5. Mọi giao dịch đều phải vào finance_transactions.
    //    Thứ tự ưu tiên match:
    //      a) Phiếu DV (service_ticket) — match ticket_code + amount
    //      b) Đơn bán phụ kiện (accessory_order) — match order_code + amount
    //      c) Đơn bán xe (sales_order) — flow cũ
    if (amountIn > 0) {
      // a) Phiếu DV
      const matchedTicket = await tryMatchServiceTicket({
        code:        data.code,
        content:     data.content,
        description: data.description,
        amount:      amountIn,
      });

      if (matchedTicket) {
        await processServiceTicketPayment({
          ticket:        matchedTicket,
          sepayId:       data.id,
          amountIn,
          txnDate:       data.transactionDate,
          content:       data.content,
          gateway:       data.gateway,
          accountNumber: data.accountNumber,
          refCode:       data.referenceCode,
          description:   data.description,
        });
        return res.status(200).json({ success: true });
      }

      // b) Đơn bán phụ kiện
      const matchedAccOrder = await tryMatchAccessoryOrder({
        code:        data.code,
        content:     data.content,
        description: data.description,
        amount:      amountIn,
      });

      if (matchedAccOrder) {
        try {
          await processPaidAccessoryOrder(matchedAccOrder.id, {
            method:       'qr_sepay',
            sepayId:      data.id,
            paidByUserId: null,
          });
          console.log(`[SEPay/PK] ✅ Đơn ${matchedAccOrder.order_code} — đã thu ${amountIn.toLocaleString('vi-VN')} ₫`);
        } catch (e) {
          console.error('[SEPay/PK] Lỗi xử lý đơn phụ kiện:', e.message);
        }
        return res.status(200).json({ success: true });
      }
    }

    // Nếu không phải phiếu DV → tiếp tục flow đơn bán hàng cũ.
    if (amountIn > 0 && data.code) {
      await processOrderPayment({
        sepayId:       data.id,
        orderCode:     data.code,
        amountIn,
        txnDate:       data.transactionDate,
        content:       data.content,
        gateway:       data.gateway,
        accountNumber: data.accountNumber,
        refCode:       data.referenceCode,
        description:   data.description,
      });
    } else {
      // Tiền ra, hoặc không có mã đơn → ghi vào finance không kèm order
      await logTransaction({
        sepayId:       data.id,
        gateway:       data.gateway,
        txnDate:       data.transactionDate,
        accountNumber: data.accountNumber,
        subAccount:    data.subAccount,
        amountIn,
        amountOut,
        accumulated:   data.accumulated,
        code:          data.code,
        content:       data.content,
        refCode:       data.referenceCode,
        description:   data.description,
        orderId:       null,
        orderCode:     data.code ?? null,
      });
    }

    // 6. Phản hồi thành công — đúng spec SEPay
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[SEPay] Lỗi xử lý webhook:', err.message);
    return res.status(200).json({ success: false, message: err.message });
    // Vẫn trả 200 để SEPay không retry (lỗi nghiệp vụ, không phải lỗi hạ tầng)
  }
};

// ── Phiếu DV: cố gắng match một phiếu DV pending qua mã DV trong content ──
//   Tiêu chí: phiếu phải `pending`, ticket_code có trong description/content/code,
//             và amount phải bằng amount của giao dịch (3B + 4B).
async function tryMatchServiceTicket({ code, content, description, amount }) {
  const haystack = [code, content, description].filter(Boolean).join(' ').toUpperCase();
  if (!haystack) return null;

  // Lấy danh sách phiếu pending — số lượng nhỏ, OK để filter ở Node
  const { data: tickets, error } = await getDb(req).from('service_tickets')
    .select('id, ticket_code, dms_code, amount, payment_status, customer_id')
    .eq('payment_status', 'pending');
  if (error || !tickets?.length) return null;

  // Match: ticket_code (vd DV202600001) xuất hiện trong haystack + amount khớp
  return tickets.find(t => {
    const code = String(t.ticket_code || '').toUpperCase().trim();
    if (!code) return false;
    return haystack.includes(code) && Number(t.amount) === Number(amount);
  }) || null;
}

// ── Phiếu DV: ghi finance_transaction + đánh dấu paid ────────────────────────
async function processServiceTicketPayment({ ticket, sepayId, amountIn, txnDate, content, gateway, accountNumber, refCode, description }) {
  const receiptDate   = txnDate ? txnDate.split(' ')[0] : new Date().toISOString().split('T')[0];
  const receiptNumber = `SEPAY-${sepayId}`;

  // Ghi finance_transaction (income — category 'dich_vu')
  const { data: ftRow, error: ftErr } = await getDb(req).from('finance_transactions')
    .insert({
      transaction_number:   receiptNumber,
      type:                 'income',
      category:             'dich_vu',
      amount:               Number(amountIn),
      payment_method:       'qr_code',
      reference_id:         ticket.id,
      reference_type:       'service_ticket',
      description:          `Thu phí DV ${ticket.ticket_code} (DMS: ${ticket.dms_code})`,
      transaction_date:     receiptDate,
      notes:                [gateway, accountNumber, refCode].filter(Boolean).join(' — ') || null,
      sepay_transaction_id: sepayId ?? null,
    })
    .select('id')
    .single();
  if (ftErr && ftErr.code !== '23505') {
    console.error('[SEPay/DV] Lưu finance thất bại:', ftErr.message);
  }

  // Đánh dấu phiếu DV đã thanh toán
  const { error: updErr } = await getDb(req).from('service_tickets')
    .update({
      payment_status:         'paid',
      sepay_transaction_id:   sepayId ? String(sepayId) : null,
      finance_transaction_id: ftRow?.id ?? null,
      paid_at:                new Date().toISOString(),
    })
    .eq('id', ticket.id);
  if (updErr) {
    console.error('[SEPay/DV] Cập nhật phiếu thất bại:', updErr.message);
    return;
  }

  console.log(`[SEPay/DV] ✅ Phiếu ${ticket.ticket_code} (DMS ${ticket.dms_code}) — đã thu ${amountIn.toLocaleString('vi-VN')} ₫`);

  // Cộng điểm tích lũy cho KH (nếu có)
  if (ticket.customer_id) {
    await awardLoyaltyPoints(ticket.customer_id, amountIn, `service_ticket:${ticket.ticket_code}`);
  }

  void content; void description;
}

// ── Đơn phụ kiện: match theo order_code + amount ────────────────────────────
async function tryMatchAccessoryOrder({ code, content, description, amount }) {
  const haystack = [code, content, description].filter(Boolean).join(' ').toUpperCase();
  if (!haystack) return null;

  const { data: orders, error } = await getDb(req).from('accessory_orders')
    .select('id, order_code, total_amount, payment_status, payment_method')
    .eq('payment_status', 'pending')
    .eq('payment_method', 'qr_sepay');
  if (error || !orders?.length) return null;

  return orders.find(o => {
    const c = String(o.order_code || '').toUpperCase().trim();
    if (!c) return false;
    return haystack.includes(c) && Number(o.total_amount) === Number(amount);
  }) || null;
}

// ── Xử lý thanh toán đơn hàng ────────────────────────────────────
async function processOrderPayment({ sepayId, orderCode, amountIn, txnDate, content, gateway, accountNumber, refCode, description }) {
  const receiptDate   = txnDate ? txnDate.split(' ')[0] : new Date().toISOString().split('T')[0];
  const receiptNumber = `SEPAY-${sepayId}`;

  // Tìm đơn hàng
  const { data: order } = await getDb(req).from('sales_orders')
    .select('id, order_number, total_amount, status')
    .eq('order_number', orderCode)
    .maybeSingle();

  // Path A: Không tìm thấy đơn → ghi finance không kèm order, dừng
  if (!order) {
    console.warn(`[SEPay] Không tìm thấy đơn "${orderCode}" — lưu finance không khớp đơn`);
    await logTransaction({
      sepayId, gateway, txnDate: receiptDate, accountNumber,
      amountIn, amountOut: 0, code: orderCode, content, refCode,
      description, orderId: null, receiptNumber, orderCode,
    });
    return;
  }

  // Path B: Đơn đã qua giai đoạn thanh toán hoặc đóng hẳn
  //   - post_payment: pdi_pending, pdi_done, invoice_requested, invoice_approved
  //   - closed:       delivered, cancelled
  //   → Vẫn ghi finance để sổ sách đầy đủ, KHÔNG ghi sales_order_payments,
  //     KHÔNG recalc status đơn. Kế toán xử lý thủ công qua ghi chú.
  const postPaymentStatuses = ['pdi_pending', 'pdi_done', 'invoice_requested', 'invoice_approved'];
  const closedStatuses      = ['delivered', 'cancelled'];
  const isPostPayment = postPaymentStatuses.includes(order.status);
  const isClosed      = closedStatuses.includes(order.status);

  if (isPostPayment || isClosed) {
    const reasonLabel = isPostPayment
      ? `đang ở giai đoạn "${order.status}" (đã thanh toán đủ)`
      : `đã "${order.status}"`;
    console.warn(`[SEPay] Đơn ${orderCode} ${reasonLabel} — lưu finance, bỏ qua cập nhật đơn`);
    await logTransaction({
      sepayId, gateway, txnDate: receiptDate, accountNumber,
      amountIn, amountOut: 0, code: orderCode, content, refCode,
      description, orderId: order.id, receiptNumber, orderCode,
      extraNotes: `⚠️ Đơn ${reasonLabel} — cần kiểm tra thủ công`,
    });
    return;
  }

  // Path C (main): Đơn đang hoạt động → ghi đủ sales_order_payments + finance + recalc
  const { data: sopRow, error: sopErr } = await getDb(req).from('sales_order_payments')
    .insert({
      order_id:             order.id,
      payment_method:       'qr_code',
      amount:               amountIn,
      payment_date:         receiptDate,
      status:               'confirmed',
      sepay_transaction_id: String(sepayId),
      confirmed_at:         new Date().toISOString(),
      notes:                `SEPay tự động — ${content ?? ''}`.trim(),
    })
    .select('id')
    .single();

  if (sopErr) {
    if (sopErr.code === '23505') {
      // sales_order_payments đã có → kiểm tra finance có chưa (dedup đã chặn ở trên nếu có)
      // Trường hợp này finance chưa có nên vẫn phải ghi
      console.warn(`[SEPay] sepay_id=${sepayId} đã có trong sales_order_payments — chỉ bổ sung finance`);
      await logTransaction({
        sepayId, gateway, txnDate: receiptDate, accountNumber,
        amountIn, amountOut: 0, code: orderCode, content, refCode,
        description, orderId: order.id, receiptNumber, orderCode,
      });
      return;
    }
    throw new Error(`Ghi sales_order_payments thất bại: ${sopErr.message}`);
  }

  // Ghi finance_transaction
  const ftData = await logTransaction({
    sepayId, gateway, txnDate: receiptDate, accountNumber,
    amountIn, amountOut: 0, code: orderCode, content, refCode,
    description, orderId: order.id, receiptNumber, orderCode,
  });

  // Liên kết ngược
  if (ftData?.id && sopRow?.id) {
    await getDb(req).from('sales_order_payments')
      .update({ finance_transaction_id: ftData.id })
      .eq('id', sopRow.id);
  }

  // Cập nhật status đơn hàng
  const result = await recalcOrderStatus(order.id);
  console.log(`[SEPay] ✅ Đơn ${orderCode} → ${result?.newStatus} | đã thu: ${result?.totalPaid?.toLocaleString('vi-VN')} ₫ | còn: ${result?.remaining?.toLocaleString('vi-VN')} ₫`);
}

// ── Lưu giao dịch vào finance_transactions — LUÔN ghi, không bao giờ bỏ qua ─
async function logTransaction({ sepayId, gateway, txnDate, accountNumber, amountIn, amountOut, code, content, refCode, orderId, receiptNumber, orderCode, extraNotes }) {
  const amount    = amountIn > 0 ? amountIn : amountOut;
  const type      = amountIn > 0 ? 'income' : 'expense';
  const txnNumber = receiptNumber ?? (sepayId ? `SEPAY-${sepayId}` : `SEPAY-${Date.now()}`);
  const descCode  = orderCode ?? code ?? '';

  const baseNotes = [gateway, accountNumber, refCode].filter(Boolean).join(' — ');
  const notes     = extraNotes ? `${extraNotes} | ${baseNotes}` : baseNotes || null;

  const { data: ftRow, error } = await getDb(req).from('finance_transactions')
    .insert({
      transaction_number:   txnNumber,
      type,
      category:             orderId ? 'ban_hang' : 'khac',
      amount:               Number(amount),
      payment_method:       'qr_code',
      reference_id:         orderId ?? null,
      reference_type:       orderId ? 'sales_order' : null,
      description:          descCode
        ? `Thu tiền đơn ${descCode} — SEPay: ${content ?? ''}`.trim()
        : `SEPay: ${content ?? ''}`.trim(),
      transaction_date:     txnDate ?? new Date().toISOString().split('T')[0],
      notes,
      sepay_transaction_id: sepayId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    // Nếu trùng transaction_number (unique) — giao dịch đã được ghi, không phải lỗi thực
    if (error.code === '23505') {
      console.warn(`[SEPay] finance_transactions trùng transaction_number "${txnNumber}" — bỏ qua`);
      return null;
    }
    console.error('[SEPay] Lưu finance_transaction thất bại:', error.message);
  }
  return ftRow ?? null;
}

module.exports = { handleSepayWebhook };
