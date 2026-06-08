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

  // 5 đơn gần nhất
  const { data: recentOrders } = useQuery<{ data: SalesOrder[]; total: number }>({
    queryKey: ['m-dashboard-recent'],
    queryFn: () => api.get('/sales', { params: { limit: 5 } }).then(r => r.data),
  });

  const todayTotal = todayOrders?.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) ?? 0;
  const todayCount = todayOrders?.total ?? 0;
  const pendingCount = pendingOrders?.total ?? 0;

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

      {/* Đơn gần đây */}
      <div className="m-card">
        <h2 className="m-card-title">Đơn gần đây</h2>
        {recentOrders?.data?.length === 0 && (
          <p className="m-card-sub">Chưa có đơn hàng nào</p>
        )}
        <div className="m-order-list-compact">
          {recentOrders?.data?.map(order => (
            <div
              key={order.id}
              className="m-order-item-compact"
              onClick={() => navigate(`/m/sales/${order.id}`)}
            >
              <div className="m-order-item-left">
                <span className="m-order-number">{order.order_number}</span>
                <span className="m-order-customer">{order.customers?.full_name || '—'}</span>
              </div>
              <div className="m-order-item-right">
                <span className="m-order-amount">{formatCurrency(order.total_amount)}</span>
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
