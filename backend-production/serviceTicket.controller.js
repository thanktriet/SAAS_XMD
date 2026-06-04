const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { awardLoyaltyPoints } = require('./loyalty.service');

// Sinh mã phiếu DV mới — DV2026XXXXX dựa trên ticket lớn nhất trong năm
async function generateTicketCode() {
  const year = new Date().getFullYear();
  const prefix = `DV${year}`;
  const { data: last } = await getDb(req).from('service_tickets')
    .select('ticket_code')
    .like('ticket_code', `${prefix}%`)
    .order('ticket_code', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextNum = 1;
  if (last?.ticket_code) {
    const num = parseInt(last.ticket_code.replace(prefix, ''), 10);
    if (!isNaN(num)) nextNum = num + 1;
  }
  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}

// ─── Danh sách phiếu DV ───────────────────────────────────────────────────────
const getServiceTickets = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    let q = getDb(req).from('service_tickets')
      .select('*, users!created_by(full_name), customers(full_name, phone, loyalty_points)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) q = q.eq('payment_status', status);
    if (search) {
      const s = String(search).trim();
      q = q.or(`ticket_code.ilike.%${s}%,dms_code.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`);
    }

    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết phiếu DV ────────────────────────────────────────────────────────
const getServiceTicketById = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('service_tickets')
      .select('*, users!created_by(full_name), customers(full_name, phone, loyalty_points)')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy phiếu DV' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo phiếu DV mới — bắt buộc gắn KH (3A) ──────────────────────────────────
const createServiceTicket = async (req, res) => {
  try {
    const { dms_code, amount, customer_id, customer_name, customer_phone, notes, payment_method } = req.body;

    // Validate
    if (!dms_code || !String(dms_code).trim()) {
      return res.status(400).json({ error: 'Mã lệnh DMS không được để trống' });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
    }
    if (!customer_id) {
      return res.status(400).json({ error: 'Phải gắn KH cho phiếu (chọn từ DB hoặc tạo mới)' });
    }
    const pm = payment_method || 'qr_sepay';
    if (!['qr_sepay', 'cash'].includes(pm)) {
      return res.status(400).json({ error: 'Phương thức thanh toán không hợp lệ' });
    }

    // Verify customer tồn tại
    const { data: cust, error: custErr } = await getDb(req).from('customers')
      .select('id, full_name, phone')
      .eq('id', customer_id)
      .single();
    if (custErr || !cust) {
      return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    }

    // Trùng DMS
    const { data: dup } = await getDb(req).from('service_tickets')
      .select('id, ticket_code')
      .eq('dms_code', String(dms_code).trim())
      .maybeSingle();
    if (dup) {
      return res.status(409).json({
        error: `Mã DMS "${dms_code}" đã có ở phiếu ${dup.ticket_code}`,
      });
    }

    const ticket_code = await generateTicketCode();

    const { data, error } = await getDb(req).from('service_tickets')
      .insert([{
        ticket_code,
        dms_code:       String(dms_code).trim(),
        customer_id:    cust.id,
        customer_name:  customer_name?.trim() || cust.full_name || null,
        customer_phone: customer_phone?.trim() || cust.phone || null,
        amount:         amt,
        payment_method: pm,
        notes:          notes?.trim() || null,
        created_by:     req.user?.sub || null,
      }])
      .select('*, users!created_by(full_name), customers(full_name, phone, loyalty_points)')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Xác nhận thu tiền mặt — chỉ accountant/manager/admin ────────────────────
const confirmCashPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: ticket, error: fetchErr } = await getDb(req).from('service_tickets')
      .select('id, ticket_code, dms_code, amount, payment_method, payment_status, customer_id')
      .eq('id', id)
      .single();
    if (fetchErr || !ticket) return res.status(404).json({ error: 'Không tìm thấy phiếu' });

    if (ticket.payment_method !== 'cash') {
      return res.status(409).json({ error: 'Phiếu này không phải thanh toán tiền mặt' });
    }
    if (ticket.payment_status !== 'pending') {
      return res.status(409).json({ error: `Phiếu đang ở trạng thái "${ticket.payment_status}"` });
    }

    // Tạo finance_transaction (cash)
    const txnNumber = `DV-CASH-${ticket.ticket_code}`;
    const { data: ft, error: ftErr } = await getDb(req).from('finance_transactions')
      .insert({
        transaction_number: txnNumber,
        type:               'income',
        category:           'dich_vu',
        amount:             Number(ticket.amount),
        payment_method:     'cash',
        reference_id:       ticket.id,
        reference_type:     'service_ticket',
        description:        `Thu tiền mặt DV ${ticket.ticket_code} (DMS: ${ticket.dms_code})`,
        transaction_date:   new Date().toISOString().split('T')[0],
        created_by:         req.user?.sub || null,
      })
      .select('id')
      .single();
    if (ftErr && ftErr.code !== '23505') {
      return res.status(400).json({ error: `Lưu finance thất bại: ${ftErr.message}` });
    }

    // Cập nhật phiếu DV
    const { data: updated, error: updErr } = await getDb(req).from('service_tickets')
      .update({
        payment_status:         'paid',
        finance_transaction_id: ft?.id ?? null,
        paid_by:                req.user?.sub || null,
        paid_at:                new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, users!created_by(full_name), customers(full_name, phone, loyalty_points)')
      .single();
    if (updErr) return res.status(400).json({ error: updErr.message });

    // Cộng điểm
    if (ticket.customer_id) {
      await awardLoyaltyPoints(ticket.customer_id, ticket.amount, `service_ticket_cash:${ticket.ticket_code}`);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Hủy phiếu DV ─────────────────────────────────────────────────────────────
const cancelServiceTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur } = await getDb(req).from('service_tickets').select('payment_status').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy phiếu DV' });
    if (cur.payment_status === 'paid') {
      return res.status(409).json({ error: 'Phiếu đã thanh toán, không thể hủy' });
    }

    const { data, error } = await getDb(req).from('service_tickets')
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
  getServiceTickets,
  getServiceTicketById,
  createServiceTicket,
  confirmCashPayment,
  cancelServiceTicket,
};
