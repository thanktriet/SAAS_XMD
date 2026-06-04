const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

const userId = (req) => req.user?.sub || null;

async function generateDepositCode() {
  const year = new Date().getFullYear();
  const prefix = `NT${year}`;
  const { data: last } = await getDb(req).from('cash_deposits')
    .select('deposit_code')
    .like('deposit_code', `${prefix}%`)
    .order('deposit_code', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextNum = 1;
  if (last?.deposit_code) {
    const num = parseInt(last.deposit_code.replace(prefix, ''), 10);
    if (!isNaN(num)) nextNum = num + 1;
  }
  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}

const getDeposits = async (req, res) => {
  try {
    const { from_date, to_date, page = 1, limit = 50 } = req.query;
    let q = getDb(req).from('cash_deposits')
      .select('*, users!created_by(full_name)', { count: 'exact' })
      .order('deposit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (from_date) q = q.gte('deposit_date', from_date);
    if (to_date)   q = q.lte('deposit_date', to_date);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createDeposit = async (req, res) => {
  try {
    const { amount, bank_name, bank_account, bank_account_name, deposit_date, receipt_number, receipt_image_url, notes } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Số tiền > 0' });
    if (!bank_name?.trim())    return res.status(400).json({ error: 'Nhập tên ngân hàng' });
    if (!bank_account?.trim()) return res.status(400).json({ error: 'Nhập số tài khoản' });

    const deposit_code = await generateDepositCode();
    const date = deposit_date || new Date().toISOString().split('T')[0];

    // Ghi finance_transaction (expense cash) → giảm quỹ tiền mặt
    const txnNumber = `NT-${deposit_code}`;
    const desc = `Nộp tiền vào ${bank_name} (${bank_account})` +
                 (receipt_number ? ` — BL: ${receipt_number}` : '');

    const { data: ft, error: ftErr } = await getDb(req).from('finance_transactions')
      .insert({
        transaction_number: txnNumber,
        type:               'expense',
        category:           'nop_ngan_hang',
        amount:             amt,
        payment_method:     'cash',
        reference_type:     'cash_deposit',
        description:        desc,
        transaction_date:   date,
        notes:              notes?.trim() || null,
        created_by:         userId(req),
      })
      .select('id')
      .single();
    if (ftErr) return res.status(400).json({ error: `Lưu finance: ${ftErr.message}` });

    const { data: dep, error: depErr } = await getDb(req).from('cash_deposits')
      .insert({
        deposit_code,
        amount:                 amt,
        bank_name:              bank_name.trim(),
        bank_account:           bank_account.trim(),
        bank_account_name:      bank_account_name?.trim() || null,
        deposit_date:           date,
        receipt_number:         receipt_number?.trim() || null,
        receipt_image_url:      receipt_image_url?.trim() || null,
        notes:                  notes?.trim() || null,
        finance_transaction_id: ft?.id ?? null,
        created_by:             userId(req),
      })
      .select('*, users!created_by(full_name)')
      .single();
    if (depErr) {
      // Rollback finance nếu ghi cash_deposits fail
      if (ft?.id) await getDb(req).from('finance_transactions').delete().eq('id', ft.id);
      return res.status(400).json({ error: depErr.message });
    }

    // Cập nhật reference_id của finance để link 2 chiều
    if (ft?.id) {
      await getDb(req).from('finance_transactions')
        .update({ reference_id: dep.id })
        .eq('id', ft.id);
    }

    res.status(201).json(dep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getDeposits, createDeposit };
