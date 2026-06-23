import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { formatCurrency, ORDER_STATUS } from '../../utils/helpers';
import { useNavigate } from 'react-router-dom';
import type { SalesOrder } from '../../types';

export default function DashboardPage() {
  const navigate = useNavigate();

  // Đơn hàng hôm nay
  const today = new Date().toISOString().split('T')[0];
  const { data: todayOrders } = useQuery<{ data: SalesOrder[]; total: number }>({
    queryKey: ['m-dashboard-today', today],
    queryFn: () => api.get('/sales', { params: { date_from: today, date_to: today, limit: 100 } }).then(r => r.data),
  });

  // Đơn pending (cần xử lý)
  const { data: pendingOrders } = useQuery<{ data: SalesOrder[]; total: number }>({
    queryKey: ['m-dashboard-pending'],
    queryFn: () => api.get('/sales', { params: { status: 'confirmed', limit: 5 } }).then(r => r.data),
  });

  // 3 đơn gần nhất
  const { data: recentOrders } = useQuery<{ data: SalesOrder[]; total: number }>({
    queryKey: ['m-dashboard-recent'],
    queryFn: () => api.get('/sales', { params: { limit: 3 } }).then(r => r.data),
  });

  // Top xe bán chạy
  const { data: topVehicles } = useQuery<any[]>({
    queryKey: ['m-dashboard-top-vehicles'],
    queryFn: () => api.get('/inventory/summary').then(r => r.data),
  });

  const todayTotal = todayOrders?.data?.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) ?? 0;
  const todayCount = todayOrders?.total ?? 0;
  const pendingCount = pendingOrders?.total ?? 0;

  // Sort by sold count
  const topSold = (topVehicles ?? [])
    .filter((v: any) => Number(v.sold) > 0)
    .sort((a: any, b: any) => Number(b.sold) - Number(a.sold))
    .slice(0, 5);

  return (
    <div className="m-page">
      {/* Doanh số hôm nay */}
      <div className="m-card">
        <h2 className="m-card-title">Doanh số hôm nay</h2>
        <p className="m-card-value">{formatCurrency(todayTotal)}</p>
        <p className="m-card-sub">{todayCount} đơn hàng</p>
      </div>

      {/* Cần xử lý */}
      <div
        className="m-card m-card-tap"
        onClick={() => navigate('/m/sales?status=confirmed')}
      >
        <h2 className="m-card-title">Cần xử lý</h2>
        <p className="m-card-value">{pendingCount}</p>
        <p className="m-card-sub">Đơn chờ xác nhận thanh toán →</p>
      </div>

      {/* Top xe bán chạy */}
      {topSold.length > 0 && (
        <div className="m-card">
          <h2 className="m-card-title">Top xe bán chạy</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topSold.map((v: any, idx: number) => (
              <div key={v.model_id || idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#c2410c' : '#e2e8f0', color: idx < 3 ? '#fff' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                  {idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.brand} {v.model_name}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>{v.sold} xe</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Đơn gần đây */}
      <div className="m-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="m-card-title" style={{ margin: 0 }}>Đơn gần đây</h2>
          <span
            style={{ fontSize: 12, color: 'var(--m-primary)', cursor: 'pointer' }}
            onClick={() => navigate('/m/sales')}
          >
            Xem tất cả →
          </span>
        </div>
        {recentOrders?.data?.length === 0 && (
          <p className="m-card-sub">Chưa có đơn hàng nào</p>
        )}
        <div className="m-order-list-compact" style={{ marginTop: 8 }}>
          {recentOrders?.data?.map(order => (
            <div
              key={order.id}
              className="m-order-item-compact"
              onClick={() => navigate(`/m/sales/${order.id}`)}
              style={{ padding: '8px 0' }}
            >
              <div className="m-order-item-left">
                <span className="m-order-number">{order.order_number}</span>
                <span className="m-order-customer" style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {order.customers?.full_name || '—'}
                </span>
              </div>
              <div className="m-order-item-right">
                <span className="m-order-amount">{formatCurrency(Number(order.total_amount) || 0)}</span>
                <span className={`m-badge ${ORDER_STATUS[order.status]?.cls || ''}`}>
                  {ORDER_STATUS[order.status]?.label || order.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
