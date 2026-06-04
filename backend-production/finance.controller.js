const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// Danh sách giao dịch
const getTransactions = async (req, res) => {
  try {
    const { type, category, from_date, to_date, sepay, page = 1, limit = 20 } = req.query;
    let query = getDb(req).from('finance_transactions')
      .select('*, users!created_by(full_name)', { count: 'exact' })
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (type)      query = query.eq('type', type);
    if (category)  query = query.eq('category', category);
    if (from_date) query = query.gte('transaction_date', from_date);
    if (to_date)   query = query.lte('transaction_date', to_date);
    // Lọc giao dịch SEPay tự động (sepay_transaction_id IS NOT NULL)
    if (sepay === 'true' || sepay === true) query = query.not('sepay_transaction_id', 'is', null);
    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo giao dịch thủ công
const createTransaction = async (req, res) => {
  try {
    const { count } = await getDb(req).from('finance_transactions').select('*', { count: 'exact', head: true });
    const transaction_number = `${req.body.type === 'income' ? 'THU' : 'CHI'}-${String(count + 1).padStart(6, '0')}`;
    const { data, error } = await getDb(req).from('finance_transactions')
      .insert([{ ...req.body, transaction_number, created_by: req.user?.sub }])
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Báo cáo doanh thu theo tháng
const getMonthlyRevenue = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('v_monthly_revenue').select('*').limit(12);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tổng quan tài chính (dashboard)
const getFinanceSummary = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    const { data } = await getDb(req).from('finance_transactions')
      .select('type, amount')
      .gte('transaction_date', firstDay)
      .lte('transaction_date', lastDay);

    const summary = (data || []).reduce((acc, t) => {
      if (t.type === 'income') acc.income += Number(t.amount);
      else acc.expense += Number(t.amount);
      return acc;
    }, { income: 0, expense: 0 });

    summary.profit = summary.income - summary.expense;
    res.json({ month: `${today.getMonth() + 1}/${today.getFullYear()}`, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tồn quỹ hôm nay — tính từ finance_transactions (đơn giản hóa, không dùng acc_period_balances)
const getCashflowToday = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Hôm nay
    const { data: todayTxns, error: err1 } = await getDb(req).from('finance_transactions')
      .select('type, amount, payment_method, category, description, transaction_date, created_at')
      .eq('transaction_date', today);
    if (err1) throw err1;

    // LŨY KẾ TẤT CẢ — để tính quỹ tiền mặt thực tế (từ trước đến hôm nay)
    const { data: allTxns, error: err2 } = await getDb(req).from('finance_transactions')
      .select('type, amount, payment_method')
      .lte('transaction_date', today);
    if (err2) throw err2;

    const sum = (arr, type, method) =>
      (arr || [])
        .filter(t => t.type === type && (!method || t.payment_method === method))
        .reduce((s, t) => s + Number(t.amount), 0);

    // Hôm nay
    const todayCashIn   = sum(todayTxns, 'income',  'cash');
    const todayBankIn   = sum(todayTxns, 'income',  'bank_transfer') + sum(todayTxns, 'income', 'qr_code');
    const todayCashOut  = sum(todayTxns, 'expense', 'cash');
    const todayBankOut  = sum(todayTxns, 'expense', 'bank_transfer') + sum(todayTxns, 'expense', 'qr_code');
    const todayExpense  = todayCashOut + todayBankOut;

    // Quỹ tiền mặt hiện tại — chỉ tính cash income − cash expense, lũy kế
    const totalCashIn  = sum(allTxns, 'income',  'cash');
    const totalCashOut = sum(allTxns, 'expense', 'cash');
    const cashBalance  = totalCashIn - totalCashOut;

    // Ngưỡng cảnh báo từ payment_settings
    const { data: setting } = await getDb(req).from('payment_settings')
      .select('value')
      .eq('key', 'max_cash_allowed')
      .maybeSingle();
    const maxCashAllowed = Number(setting?.value) || 50_000_000;

    res.json({
      today: {
        cash_in:    todayCashIn,
        bank_in:    todayBankIn,
        total_in:   todayCashIn + todayBankIn,
        cash_out:   todayCashOut,
        bank_out:   todayBankOut,
        total_out:  todayExpense,
      },
      cash_balance:        cashBalance,           // quỹ tiền mặt hiện tại
      max_cash_allowed:    maxCashAllowed,
      is_over_threshold:   cashBalance > maxCashAllowed,
      transactions_today:  todayTxns ?? [],
      updated_at:          new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getTransactions, createTransaction, getMonthlyRevenue, getFinanceSummary, getCashflowToday };
