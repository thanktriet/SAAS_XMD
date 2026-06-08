const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { generateCode } = require('./codeGenerator');

const userId = (req) => req.user?.sub || null;

// Sinh mã phiếu tạm ứng — có prefix chi nhánh
async function generateAdvanceCode(req) {
  return generateCode(req, {
    table: 'cash_advances', column: 'advance_code',
    prefix: 'PC', padLength: 5, yearInPrefix: true,
  });
}

// ─── Danh sách ────────────────────────────────────────────────────────────────
const getAdvances = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    let q = getDb(req).from('cash_advances')
      .select(`
        *,
        requester:users!requested_by(full_name),
        approver:users!approved_by(full_name),
        reconciler:users!reconciled_by(full_name),
        sales_orders(order_number, customers(full_name))
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) q = q.eq('status', status);
    if (search) {
      q = q.or(`advance_code.ilike.%${search}%,purpose.ilike.%${search}%,receipt_number.ilike.%${search}%`);
    }

    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết ─────────────────────────────────────────────────────────────────
const getAdvanceById = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('cash_advances')
      .select(`
        *,
        requester:users!requested_by(full_name, phone),
        approver:users!approved_by(full_name),
        reconciler:users!reconciled_by(full_name),
        sales_orders(order_number, total_amount, customers(full_name, phone))
      `)
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo phiếu (pending) — ai cũng tạo được ──────────────────────────────────
const createAdvance = async (req, res) => {
  try {
    const { purpose, amount_requested, sales_order_id, notes } = req.body;
    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({ error: 'Nhập mục đích chi' });
    }
    const amt = Number(amount_requested);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Số tiền yêu cầu phải > 0' });
    }

    const advance_code = await generateAdvanceCode(req);

    const { data, error } = await getDb(req).from('cash_advances')
      .insert([{
        advance_code,
        purpose:          String(purpose).trim(),
        amount_requested: amt,
        sales_order_id:   sales_order_id || null,
        notes:            notes?.trim() || null,
        requested_by:     userId(req),
      }])
      .select(`
        *,
        requester:users!requested_by(full_name),
        sales_orders(order_number)
      `)
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Duyệt phiếu (pending → approved) ────────────────────────────────────────
const approveAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur } = await getDb(req).from('cash_advances').select('status').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
    if (cur.status !== 'pending') {
      return res.status(409).json({ error: `Phiếu đang ở "${cur.status}", không thể duyệt` });
    }

    const { data, error } = await getDb(req).from('cash_advances')
      .update({
        status:       'approved',
        approved_by:  userId(req),
        approved_at:  new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Từ chối (pending → rejected) ─────────────────────────────────────────────
const rejectAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { reject_reason } = req.body;
    if (!reject_reason?.trim()) {
      return res.status(400).json({ error: 'Phải nhập lý do từ chối' });
    }
    const { data: cur } = await getDb(req).from('cash_advances').select('status').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy' });
    if (cur.status !== 'pending') {
      return res.status(409).json({ error: `Phiếu đang ở "${cur.status}"` });
    }

    const { data, error } = await getDb(req).from('cash_advances')
      .update({
        status:        'rejected',
        approved_by:   userId(req),
        approved_at:   new Date().toISOString(),
        reject_reason: reject_reason.trim(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Hoàn tất biên lai (approved → completed) ─────────────────────────────────
const completeAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_actual, receipt_number, receipt_date, receipt_image_url, notes } = req.body;

    const amt = Number(amount_actual);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Số tiền thực chi phải > 0' });
    // Bỏ bắt buộc số biên lai/ngày — chỉ cần upload ảnh scan là đủ
    if (!receipt_image_url) {
      return res.status(400).json({ error: 'Phải upload ảnh scan biên lai' });
    }

    const { data: cur } = await getDb(req).from('cash_advances').select('status').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy' });
    if (cur.status !== 'approved') {
      return res.status(409).json({ error: `Phiếu phải ở trạng thái "approved" (đang: ${cur.status})` });
    }

    const updateBody = {
      status:            'completed',
      amount_actual:     amt,
      receipt_image_url,
      completed_at:      new Date().toISOString(),
    };
    if (receipt_number?.trim()) updateBody.receipt_number = receipt_number.trim();
    if (receipt_date)           updateBody.receipt_date   = receipt_date;
    if (notes != null) updateBody.notes = notes.trim() || null;

    const { data, error } = await getDb(req).from('cash_advances')
      .update(updateBody)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Đối chiếu (completed → reconciled) — ghi finance_transactions ────────────
const reconcileAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur, error: fErr } = await getDb(req).from('cash_advances').select('*').eq('id', id).single();
    if (fErr || !cur) return res.status(404).json({ error: 'Không tìm thấy' });
    if (cur.status !== 'completed') {
      return res.status(409).json({ error: `Phiếu phải ở trạng thái "completed"` });
    }

    // Ghi finance_transaction (chi tiền mặt)
    const txnNumber = `PC-${cur.advance_code}`;
    const { data: ft, error: ftErr } = await getDb(req).from('finance_transactions')
      .insert({
        transaction_number: txnNumber,
        type:               'expense',
        category:           'dich_vu_dang_ky',
        amount:             Number(cur.amount_actual),
        payment_method:     'cash',
        reference_id:       cur.id,
        reference_type:     'cash_advance',
        description:        `${cur.advance_code} — ${cur.purpose}` +
                            (cur.receipt_number ? ` (BL: ${cur.receipt_number})` : ''),
        transaction_date:   cur.receipt_date || new Date().toISOString().split('T')[0],
        created_by:         userId(req),
      })
      .select('id')
      .single();
    if (ftErr && ftErr.code !== '23505') {
      return res.status(400).json({ error: `Lưu finance thất bại: ${ftErr.message}` });
    }

    const { data, error } = await getDb(req).from('cash_advances')
      .update({
        status:                 'reconciled',
        reconciled_by:          userId(req),
        reconciled_at:          new Date().toISOString(),
        finance_transaction_id: ft?.id ?? null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Hủy phiếu ────────────────────────────────────────────────────────────────
const cancelAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur } = await getDb(req).from('cash_advances').select('status').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy' });
    if (['completed', 'reconciled'].includes(cur.status)) {
      return res.status(409).json({ error: 'Phiếu đã hoàn tất, không thể hủy' });
    }

    const { data, error } = await getDb(req).from('cash_advances')
      .update({ status: 'cancelled' })
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
  getAdvances,
  getAdvanceById,
  createAdvance,
  approveAdvance,
  rejectAdvance,
  completeAdvance,
  reconcileAdvance,
  cancelAdvance,
};
