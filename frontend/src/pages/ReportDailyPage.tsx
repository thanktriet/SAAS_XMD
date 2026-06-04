// Trang Báo cáo ngày — KPI + breakdown thanh toán + danh sách đơn + xuất Excel
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import api from '../services/api';
import { formatCurrency, formatDate, ORDER_STATUS, PAYMENT_METHOD } from '../utils/helpers';
import toast from 'react-hot-toast';

interface DailyReport {
  date: string;
  summary: {
    total_orders:          number;   // số đơn xe có thu tiền hôm nay
    total_new_orders:      number;   // đơn lập mới trong ngày (tham khảo)
    total_cancelled:       number;
    total_revenue:         number;   // = tiền xe thực thu trong ngày
    total_service_revenue: number;   // doanh thu DV + phụ kiện
    total_grand_revenue:   number;   // tổng
    total_collected:       number;
    total_services:        number;
    total_income:          number;
    total_expense:         number;
    net_cashflow:          number;
  };
  payment_breakdown: Record<string, number>;
  models_sold:       { name: string; qty: number }[];
  orders: Array<{
    id: string; order_number: string;
    total_amount: number; deposit_amount: number;
    collected_today: number;
    status: string; payment_method: string;
    order_date: string; created_at: string;
    customers?:    { full_name: string; phone: string } | null;
    users?:        { full_name: string } | null;
    sales_order_items?: Array<{
      quantity: number;
      vehicle_models?: { brand: string; model_name: string } | null;
      inventory_vehicles?: { color: string | null; vin: string | null } | null;
    }>;
  }>;
}

export default function ReportDailyPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery<DailyReport>({
    queryKey: ['report-daily', date],
    queryFn: () => api.get('/reports/daily', { params: { date } }).then(r => r.data),
  });

  const s = data?.summary;
  const cards = [
    { label: 'Đơn có thu tiền',     value: s?.total_orders ?? 0,                     icon: '🛒', cls: 'blue',   suffix: 'đơn' },
    { label: 'Đơn lập mới',          value: s?.total_new_orders ?? 0,                 icon: '📝', cls: 'gray',   suffix: 'đơn' },
    { label: 'Đơn huỷ',              value: s?.total_cancelled ?? 0,                  icon: '❌', cls: 'red',    suffix: 'đơn' },
    { label: 'Tiền xe thực thu',     value: formatCurrency(s?.total_revenue ?? 0),    icon: '🏍️', cls: 'purple', suffix: '' },
    { label: 'Tiền DV + PK',         value: formatCurrency(s?.total_service_revenue ?? 0), icon: '🔧', cls: 'cyan', suffix: '' },
    { label: 'Tổng thu trong ngày',  value: formatCurrency(s?.total_grand_revenue ?? 0),   icon: '💰', cls: 'green', suffix: '' },
    { label: 'Phiếu DV + PK paid',   value: s?.total_services ?? 0,                   icon: '🔧', cls: 'orange', suffix: 'phiếu' },
    { label: 'Dòng tiền ròng',       value: formatCurrency(s?.net_cashflow ?? 0),     icon: '📊', cls: (s?.net_cashflow ?? 0) >= 0 ? 'green' : 'red', suffix: '' },
  ];

  function xuatExcel() {
    if (!data) return;
    const orders = data.orders ?? [];
    if (orders.length === 0) {
      toast.error('Không có đơn để xuất');
      return;
    }

    const rows = orders.map((o, i) => {
      const items = o.sales_order_items ?? [];
      const first = items[0];
      const tenXe = first ? `${first.vehicle_models?.brand ?? ''} ${first.vehicle_models?.model_name ?? ''}`.trim() : '';
      const xeThem = items.length > 1 ? ` +${items.length - 1}` : '';
      return {
        STT:           i + 1,
        'Mã đơn':      o.order_number,
        'Khách hàng':  o.customers?.full_name ?? '',
        'SĐT':          o.customers?.phone ?? '',
        'Mẫu xe':      tenXe + xeThem,
        'Màu':          first?.inventory_vehicles?.color ?? '',
        'VIN':          first?.inventory_vehicles?.vin ?? '',
        'Nhân viên':   o.users?.full_name ?? '',
        'Tổng tiền đơn': o.total_amount,
        'Thu hôm nay':  o.collected_today,
        'PT thanh toán': PAYMENT_METHOD[o.payment_method] ?? o.payment_method,
        'Trạng thái':  ORDER_STATUS[o.status]?.label ?? o.status,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 24 },
      { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 16 },
    ];

    // Sheet tóm tắt
    const sumRows = [
      { 'Chỉ số': 'Đơn có thu tiền',     'Giá trị': data.summary.total_orders },
      { 'Chỉ số': 'Đơn lập mới',          'Giá trị': data.summary.total_new_orders },
      { 'Chỉ số': 'Đơn huỷ',              'Giá trị': data.summary.total_cancelled },
      { 'Chỉ số': 'Tiền xe thực thu',     'Giá trị': data.summary.total_revenue },
      { 'Chỉ số': 'Tiền DV + PK',         'Giá trị': data.summary.total_service_revenue },
      { 'Chỉ số': 'Tổng thu trong ngày',  'Giá trị': data.summary.total_grand_revenue },
      { 'Chỉ số': 'Số phiếu DV+PK paid',  'Giá trị': data.summary.total_services },
      { 'Chỉ số': 'Thu (tài chính)',      'Giá trị': data.summary.total_income },
      { 'Chỉ số': 'Chi (tài chính)',      'Giá trị': data.summary.total_expense },
      { 'Chỉ số': 'Dòng tiền ròng',       'Giá trị': data.summary.net_cashflow },
    ];
    const wsSum = XLSX.utils.json_to_sheet(sumRows);
    wsSum['!cols'] = [{ wch: 22 }, { wch: 18 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSum, 'Tóm tắt');
    XLSX.utils.book_append_sheet(wb, ws, 'Đơn hàng');
    XLSX.writeFile(wb, `bao-cao-ngay-${date}.xlsx`);
    toast.success(`Đã xuất báo cáo ngày ${date}`);
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📅 Báo cáo ngày</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().split('T')[0]}
            onChange={e => setDate(e.target.value)}
            style={{
              padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6,
              fontSize: 13, outline: 'none',
            }}
          />
          <button className="btn btn-secondary" onClick={xuatExcel} disabled={!data}>
            📊 Xuất Excel
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            🖨️ In
          </button>
        </div>
      </div>

      <div className="page-content">
        {isLoading ? (
          <div className="loading-center"><div className="spinner" style={{ width: 36, height: 36 }} /></div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="stat-grid">
              {cards.map(c => (
                <div className={`stat-card ${c.cls}`} key={c.label}>
                  <div className="icon" style={{
                    float: 'right', width: 44, height: 44, borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  }}>{c.icon}</div>
                  <div className="label">{c.label}</div>
                  <div className="value">{c.value}</div>
                  {c.suffix && <div className="change">{c.suffix}</div>}
                </div>
              ))}
            </div>

            {/* Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginTop: 16 }}>

              {/* Phương thức thanh toán */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">💳 Thu theo phương thức</span>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  {Object.keys(data?.payment_breakdown ?? {}).length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                      Chưa có thanh toán nào
                    </div>
                  ) : (
                    Object.entries(data!.payment_breakdown).map(([method, amt], i, arr) => (
                      <div key={method} style={{
                        padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none',
                      }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                          {PAYMENT_METHOD[method] ?? method}
                        </span>
                        <strong style={{ color: '#15803d', fontSize: 14 }}>{formatCurrency(amt)}</strong>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Mẫu xe đã bán */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">🏍️ Mẫu xe đã bán trong ngày</span>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  {(data?.models_sold ?? []).length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                      Chưa có xe nào được bán
                    </div>
                  ) : (
                    data!.models_sold.map((m, i, arr) => (
                      <div key={m.name} style={{
                        padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none',
                      }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{m.name}</span>
                        <span style={{
                          background: '#eff6ff', color: '#1d4ed8',
                          padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                        }}>{m.qty} xe</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Bảng đơn hàng */}
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">
                <span className="card-title">📋 Đơn xe có thu tiền trong ngày ({data?.orders?.length ?? 0})</span>
              </div>
              <div className="table-wrap">
                {(data?.orders?.length ?? 0) === 0 ? (
                  <div className="empty-state"><p>Không có đơn nào thu tiền trong ngày {formatDate(date)}</p></div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Mã đơn</th>
                        <th>Khách hàng</th>
                        <th className="hide-mobile">Mẫu xe</th>
                        <th className="hide-mobile">Nhân viên</th>
                        <th style={{ textAlign: 'right' }}>Tổng đơn</th>
                        <th style={{ textAlign: 'right' }}>Thu hôm nay</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.orders.map(o => {
                        const items = o.sales_order_items ?? [];
                        const first = items[0];
                        const tenXe = first ? `${first.vehicle_models?.brand ?? ''} ${first.vehicle_models?.model_name ?? ''}`.trim() : '—';
                        return (
                          <tr key={o.id}>
                            <td><span className="font-mono text-primary">{o.order_number}</span></td>
                            <td className="fw-600">
                              {o.customers?.full_name}
                              <br />
                              <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>{o.customers?.phone}</span>
                            </td>
                            <td className="hide-mobile">
                              {tenXe}
                              {items.length > 1 && <span className="text-muted" style={{ fontSize: 11 }}> +{items.length - 1}</span>}
                            </td>
                            <td className="text-muted hide-mobile">{o.users?.full_name || '-'}</td>
                            <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(o.total_amount)}</td>
                            <td style={{ textAlign: 'right', color: '#15803d', fontWeight: 700 }}>
                              {formatCurrency(o.collected_today)}
                            </td>
                            <td>
                              <span className={`badge ${ORDER_STATUS[o.status]?.cls || 'badge-gray'}`}>
                                {ORDER_STATUS[o.status]?.label || o.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
