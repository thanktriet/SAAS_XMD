const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// Helper: tính ngày đầu tháng N tháng trước (offset 0 = tháng hiện tại, 1 = tháng trước)
function getMonthRange(monthsAgo = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const end   = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 1);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

// Tính % thay đổi giữa 2 tháng (so với current)
function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// Các status được tính là doanh thu đã ghi nhận (đã thu đủ tiền trở đi)
const REVENUE_STATUSES = [
  'full_paid', 'invoice_requested', 'invoice_approved',
  'pdi_pending', 'pdi_done', 'delivered',
];

// Dashboard tổng quan
const getDashboard = async (req, res) => {
  try {
    const m0 = getMonthRange(0); // Tháng hiện tại
    const m1 = getMonthRange(1); // Tháng trước

    const [
      vehicleStock,
      ordersThisMonth, ordersLastMonth,
      ordersDraft,
      serviceTicketsPending,
      revenueThisMonth, revenueLastMonth,
      // Phiếu DV (service_tickets) — paid trong tháng
      serviceRevenueThis, serviceRevenueLast,
      serviceCountThisMonth,
      // Đơn bán phụ kiện (accessory_orders) — paid trong tháng
      accOrderRevenueThis, accOrderRevenueLast,
      accOrderCountThisMonth,
      recentOrders,
    ] = await Promise.all([
      // Tồn kho xe
      getDb(req).from('inventory_vehicles').select('id', { count: 'exact', head: true }).eq('status', 'in_stock'),

      // Đơn hàng tháng này (loại huỷ)
      getDb(req).from('sales_orders').select('id', { count: 'exact', head: true })
        .gte('order_date', m0.start).lt('order_date', m0.end).neq('status', 'cancelled'),

      // Đơn hàng tháng trước (loại huỷ)
      getDb(req).from('sales_orders').select('id', { count: 'exact', head: true })
        .gte('order_date', m1.start).lt('order_date', m1.end).neq('status', 'cancelled'),

      // Đơn cần xác nhận (status = draft)
      getDb(req).from('sales_orders').select('id', { count: 'exact', head: true }).eq('status', 'draft'),

      // Phiếu DV + đơn phụ kiện đang chờ thanh toán
      getDb(req).from('service_tickets').select('id', { count: 'exact', head: true })
        .eq('payment_status', 'pending'),

      // Doanh thu xe tháng này (sum total_amount đơn đã thu đủ trở lên)
      getDb(req).from('sales_orders').select('total_amount')
        .gte('order_date', m0.start).lt('order_date', m0.end).in('status', REVENUE_STATUSES),
      getDb(req).from('sales_orders').select('total_amount')
        .gte('order_date', m1.start).lt('order_date', m1.end).in('status', REVENUE_STATUSES),

      // Doanh thu phiếu DV tháng này (paid)
      getDb(req).from('service_tickets').select('amount')
        .gte('paid_at', m0.start).lt('paid_at', m0.end).eq('payment_status', 'paid'),
      getDb(req).from('service_tickets').select('amount')
        .gte('paid_at', m1.start).lt('paid_at', m1.end).eq('payment_status', 'paid'),
      getDb(req).from('service_tickets').select('id', { count: 'exact', head: true })
        .gte('created_at', m0.start).lt('created_at', m0.end).neq('payment_status', 'cancelled'),

      // Doanh thu đơn phụ kiện tháng này (paid)
      getDb(req).from('accessory_orders').select('total_amount')
        .gte('paid_at', m0.start).lt('paid_at', m0.end).eq('payment_status', 'paid'),
      getDb(req).from('accessory_orders').select('total_amount')
        .gte('paid_at', m1.start).lt('paid_at', m1.end).eq('payment_status', 'paid'),
      getDb(req).from('accessory_orders').select('id', { count: 'exact', head: true })
        .gte('created_at', m0.start).lt('created_at', m0.end).neq('payment_status', 'cancelled'),

      // 3 đơn gần đây nhất
      getDb(req).from('sales_orders')
        .select(`
          id, order_number, total_amount, status, order_date, deposit_amount,
          customers(full_name, phone)
        `)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    // Doanh thu xe
    const totalRevenueThis = (revenueThisMonth.data || []).reduce((s, t) => s + Number(t.total_amount || 0), 0);
    const totalRevenueLast = (revenueLastMonth.data || []).reduce((s, t) => s + Number(t.total_amount || 0), 0);

    // Doanh thu dịch vụ + đơn phụ kiện
    const serviceTicketRevThis = (serviceRevenueThis.data  || []).reduce((s, t) => s + Number(t.amount || 0), 0);
    const serviceTicketRevLast = (serviceRevenueLast.data  || []).reduce((s, t) => s + Number(t.amount || 0), 0);
    const accOrderRevThis      = (accOrderRevenueThis.data || []).reduce((s, t) => s + Number(t.total_amount || 0), 0);
    const accOrderRevLast      = (accOrderRevenueLast.data || []).reduce((s, t) => s + Number(t.total_amount || 0), 0);

    const totalServiceRevenueThis = serviceTicketRevThis + accOrderRevThis;
    const totalServiceRevenueLast = serviceTicketRevLast + accOrderRevLast;

    // Tổng doanh thu (xe + dịch vụ + phụ kiện)
    const grandRevenueThis = totalRevenueThis + totalServiceRevenueThis;
    const grandRevenueLast = totalRevenueLast + totalServiceRevenueLast;

    // Aggregate top models — SQL direct pour fiabilité
    const pool = require('./database');
    const branchId = req.user?.branch_id;
    let topModels = [];
    {
      const branchFilter = branchId ? `AND so.branch_id = '${branchId}'` : '';
      const { rows } = await pool.query(`
        SELECT soi.vehicle_model_id, vm.brand, vm.model_name,
               SUM(soi.quantity) as total_qty,
               SUM(soi.line_total::numeric) as total_revenue
        FROM sales_order_items soi
        JOIN sales_orders so ON so.id = soi.order_id
        JOIN vehicle_models vm ON vm.id = soi.vehicle_model_id
        WHERE so.order_date >= $1 AND so.order_date < $2
          AND so.status != 'cancelled'
          ${branchFilter}
        GROUP BY soi.vehicle_model_id, vm.brand, vm.model_name
        ORDER BY total_qty DESC
        LIMIT 5
      `, [m0.start, m0.end]);

      topModels = rows.map(r => ({
        vehicle_model_id: r.vehicle_model_id,
        brand: r.brand,
        model_name: r.model_name,
        quantity: Number(r.total_qty),
        revenue: Number(r.total_revenue),
      }));
    }

    res.json({
      // KPI cards
      vehicles_in_stock:      vehicleStock.count ?? 0,
      orders_this_month:      ordersThisMonth.count ?? 0,
      orders_pending:         ordersDraft.count ?? 0,
      open_service_tickets:   serviceTicketsPending.count ?? 0,
      service_count_this_month: (serviceCountThisMonth.count ?? 0) + (accOrderCountThisMonth.count ?? 0),
      revenue_this_month:     totalRevenueThis,           // doanh thu xe
      service_revenue_this_month: totalServiceRevenueThis, // doanh thu dịch vụ + phụ kiện
      grand_revenue_this_month: grandRevenueThis,         // tổng

      // So sánh tháng trước
      orders_change_pct:        pctChange(ordersThisMonth.count ?? 0, ordersLastMonth.count ?? 0),
      revenue_change_pct:       pctChange(totalRevenueThis, totalRevenueLast),
      service_revenue_change_pct: pctChange(totalServiceRevenueThis, totalServiceRevenueLast),
      grand_revenue_change_pct: pctChange(grandRevenueThis, grandRevenueLast),

      // Bonus
      top_models:    topModels,
      recent_orders: recentOrders.data ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getDashboard, getDailyReport };

// ══════════════════════════════════════════════════════════════════════════════
// BÁO CÁO NGÀY — GET /api/reports/daily?date=YYYY-MM-DD
// ──────────────────────────────────────────────────────────────────────────────
// Khoảng ngày tính theo múi giờ Việt Nam (UTC+7):
//   start = dateStr 00:00:00 +07:00
//   end   = (dateStr+1) 00:00:00 +07:00
// ══════════════════════════════════════════════════════════════════════════════
const VN_OFFSET = '+07:00';

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getDailyReport(req, res) {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'Tham số date phải có dạng YYYY-MM-DD' });
    }

    const nextDateStr = addDaysISO(dateStr, 1);
    // Cho cột timestamptz: dùng ISO có offset VN
    const startTs = `${dateStr}T00:00:00${VN_OFFSET}`;
    const endTs   = `${nextDateStr}T00:00:00${VN_OFFSET}`;
    // Cho cột date thuần: dùng YYYY-MM-DD
    const startDt = dateStr;
    const endDt   = nextDateStr;

    // ── Bước 1: lấy các nguồn TIỀN THỰC THU trong ngày ─────────────────────
    const [payments, services, accOrders, txs, ordersCreated] = await Promise.all([
      // Thanh toán xe đã confirmed trong ngày
      getDb(req).from('sales_order_payments')
        .select('id, amount, payment_method, status, payment_date, order_id')
        .eq('status', 'confirmed')
        .gte('payment_date', startDt).lt('payment_date', endDt),

      // Phiếu DV paid trong ngày
      getDb(req).from('service_tickets')
        .select('id, ticket_code, dms_code, amount, payment_status, payment_method, paid_at, customer_name')
        .gte('paid_at', startTs).lt('paid_at', endTs)
        .eq('payment_status', 'paid'),

      // Đơn phụ kiện paid trong ngày
      getDb(req).from('accessory_orders')
        .select('id, order_code, total_amount, payment_status, payment_method, paid_at, customer_name')
        .gte('paid_at', startTs).lt('paid_at', endTs)
        .eq('payment_status', 'paid'),

      // Thu/chi tài chính trong ngày
      getDb(req).from('finance_transactions')
        .select('id, type, amount, payment_method, category')
        .gte('transaction_date', startDt).lt('transaction_date', endDt),

      // Đơn xe được lập trong ngày — chỉ để hiển thị tham khảo
      getDb(req).from('sales_orders')
        .select('id, status, created_at')
        .gte('created_at', startTs).lt('created_at', endTs),
    ]);

    const queryNames = ['payments', 'services', 'accOrders', 'txs', 'ordersCreated'];
    const results = [payments, services, accOrders, txs, ordersCreated];
    const errIndex = results.findIndex(r => r.error);
    if (errIndex >= 0) {
      const err = results[errIndex].error;
      console.error(`[reports/daily] query "${queryNames[errIndex]}" failed:`, err);
      return res.status(500).json({
        error: err.message,
        failed_query: queryNames[errIndex],
        details: err.details ?? null,
        hint:    err.hint    ?? null,
        code:    err.code    ?? null,
      });
    }

    const paymentsData      = payments.data       ?? [];
    const servicesData      = services.data       ?? [];
    const accOrdersData     = accOrders.data      ?? [];
    const txsData           = txs.data            ?? [];
    const ordersCreatedData = ordersCreated.data  ?? [];

    // ── Bước 2: lấy chi tiết các đơn xe có thu tiền trong ngày ──────────────
    const orderIds = [...new Set(paymentsData.map(p => p.order_id).filter(Boolean))];
    let ordersWithPaymentData = [];
    if (orderIds.length > 0) {
      const { data, error } = await getDb(req).from('sales_orders')
        .select(`
          id, order_number, total_amount, deposit_amount, status, payment_method,
          order_date, created_at,
          customers(full_name, phone),
          users!salesperson_id(full_name),
          sales_order_items(
            quantity,
            vehicle_models(brand, model_name),
            inventory_vehicles(color, vin)
          )
        `)
        .in('id', orderIds)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[reports/daily] query "ordersWithPayment" failed:', error);
        return res.status(500).json({
          error: error.message,
          failed_query: 'ordersWithPayment',
          code: error.code ?? null,
        });
      }
      ordersWithPaymentData = data ?? [];
    }

    // Map order_id → tổng tiền thu hôm nay (để hiển thị cạnh đơn)
    const collectedByOrder = {};
    for (const p of paymentsData) {
      const k = p.order_id;
      if (!k) continue;
      collectedByOrder[k] = (collectedByOrder[k] || 0) + Number(p.amount || 0);
    }

    // ── Bước 3: tính KPI cash-based ─────────────────────────────────────────
    // Doanh thu xe = tiền xe THỰC THU trong ngày
    const totalRevenue    = paymentsData.reduce((s, p) => s + Number(p.amount || 0), 0);

    // Doanh thu DV + PK
    const serviceRev      = servicesData.reduce((s, t) => s + Number(t.amount || 0), 0);
    const accOrderRev     = accOrdersData.reduce((s, t) => s + Number(t.total_amount || 0), 0);
    const totalServiceRev = serviceRev + accOrderRev;

    // Tổng thu = tất cả nguồn tiền vào
    const totalCollected  = totalRevenue + totalServiceRev;

    // Số đơn xe có thu tiền (unique)
    const totalOrders     = orderIds.length;

    // Đơn mới lập trong ngày + đơn huỷ trong ngày — tham khảo
    const totalNewOrders  = ordersCreatedData.length;
    const totalCancelled  = ordersCreatedData.filter(o => o.status === 'cancelled').length;

    // Số phiếu DV + PK paid
    const totalServices   = servicesData.length + accOrdersData.length;

    // Thu/chi tài chính (giữ nguyên)
    const totalIncome     = txsData.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalExpense    = txsData.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);

    // ── Bước 4: breakdown theo phương thức thanh toán (gộp tất cả nguồn) ────
    const paymentBreakdown = {};
    const addToBreakdown = (method, amount) => {
      const m = method || 'other';
      paymentBreakdown[m] = (paymentBreakdown[m] || 0) + Number(amount || 0);
    };
    for (const p of paymentsData)  addToBreakdown(p.payment_method, p.amount);
    for (const t of servicesData)  addToBreakdown(t.payment_method, t.amount);
    for (const a of accOrdersData) addToBreakdown(a.payment_method, a.total_amount);

    // ── Bước 5: mẫu xe đã bán = items thuộc đơn có thu tiền hôm nay ────────
    const modelMap = {};
    for (const o of ordersWithPaymentData) {
      if (o.status === 'cancelled') continue;
      for (const it of o.sales_order_items ?? []) {
        const k = it.vehicle_models ? `${it.vehicle_models.brand} ${it.vehicle_models.model_name}` : '—';
        modelMap[k] = (modelMap[k] || 0) + Number(it.quantity || 0);
      }
    }
    const modelsSold = Object.entries(modelMap)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);

    // Gắn collected_today vào từng đơn để frontend hiển thị
    const ordersOut = ordersWithPaymentData.map(o => ({
      ...o,
      collected_today: collectedByOrder[o.id] || 0,
    }));

    res.json({
      date: dateStr,
      summary: {
        total_orders:           totalOrders,        // số đơn xe có thu tiền hôm nay
        total_new_orders:       totalNewOrders,     // đơn lập mới trong ngày (tham khảo)
        total_cancelled:        totalCancelled,
        total_revenue:          totalRevenue,       // = tiền xe thực thu
        total_service_revenue:  totalServiceRev,
        total_grand_revenue:    totalRevenue + totalServiceRev,
        total_collected:        totalCollected,     // = grand revenue (tổng thu)
        total_services:         totalServices,
        total_income:           totalIncome,
        total_expense:          totalExpense,
        net_cashflow:           totalIncome - totalExpense,
      },
      payment_breakdown: paymentBreakdown,
      models_sold:       modelsSold,
      orders:            ordersOut,
      service_tickets:   servicesData,
      accessory_orders:  accOrdersData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
