// Dashboard - Trang tổng quan
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { DashboardStats } from '../types';
import { formatCurrency, formatDate, ORDER_STATUS } from '../utils/helpers';

// ─── Helper hiển thị badge thay đổi ──────────────────────────────────────────
function ChangeBadge({ pct }: { pct: number }) {
  if (pct === 0) {
    return <span style={{ fontSize: 11, color: '#9ca3af' }}>= so với tháng trước</span>;
  }
  const up = pct > 0;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      color: up ? '#16a34a' : '#dc2626',
    }}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% so với tháng trước
    </span>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data),
    refetchInterval: 60000,
  });

  const cards = [
    {
      label: 'Xe trong kho',
      value: stats?.vehicles_in_stock ?? 0,
      icon: '🏍️',
      cls: 'blue',
      unit: 'xe',
      onClick: () => navigate('/inventory'),
    },
    {
      label: 'Đơn hàng tháng này',
      value: stats?.orders_this_month ?? 0,
      icon: '🛒',
      cls: 'green',
      unit: 'đơn',
      change: stats?.orders_change_pct,
      onClick: () => navigate('/sales'),
    },
    {
      label: 'Đơn cần xác nhận',
      value: stats?.orders_pending ?? 0,
      icon: '⏳',
      cls: 'orange',
      unit: 'đơn',
      onClick: () => navigate('/sales'),
    },
    {
      label: 'Phiếu DV chờ thu',
      value: stats?.open_service_tickets ?? 0,
      icon: '🔧',
      cls: 'red',
      unit: 'phiếu',
      onClick: () => navigate('/services'),
    },
    {
      label: 'Doanh thu xe',
      value: formatCurrency(stats?.revenue_this_month ?? 0),
      icon: '🏍️',
      cls: 'purple',
      unit: '',
      change: stats?.revenue_change_pct,
      onClick: () => navigate('/finance'),
    },
    {
      label: 'Doanh thu dịch vụ + phụ kiện',
      value: formatCurrency(stats?.service_revenue_this_month ?? 0),
      icon: '🔧',
      cls: 'cyan',
      unit: '',
      change: stats?.service_revenue_change_pct,
      onClick: () => navigate('/services'),
    },
    {
      label: 'Tổng doanh thu',
      value: formatCurrency(stats?.grand_revenue_this_month ?? 0),
      icon: '💰',
      cls: 'green',
      unit: '',
      change: stats?.grand_revenue_change_pct,
      onClick: () => navigate('/finance'),
    },
  ];

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📊 Dashboard Tổng quan</span>
        <span className="text-muted" style={{ fontSize: 13 }}>
          {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
      </div>

      <div className="page-content">
        {isLoading ? (
          <div className="loading-center"><div className="spinner" style={{ width: 36, height: 36 }} /></div>
        ) : (
          <div className="stat-grid">
            {cards.map(card => (
              <div
                className={`stat-card ${card.cls}`}
                key={card.label}
                onClick={card.onClick}
                style={{ cursor: 'pointer' }}
              >
                <div className="icon" style={{
                  float: 'right', width: 44, height: 44, borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>
                  {card.icon}
                </div>
                <div className="label">{card.label}</div>
                <div className="value">{card.value}</div>
                <div className="change">
                  {card.change !== undefined
                    ? <ChangeBadge pct={card.change} />
                    : card.unit}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Top mẫu xe + Đơn gần đây */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginTop: 16 }}>

          {/* ── Top 5 mẫu xe bán chạy ── */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">🏆 Top mẫu xe tháng này</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {(stats?.top_models?.length ?? 0) === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  Chưa có dữ liệu bán hàng tháng này
                </div>
              ) : (
                stats!.top_models.map((m, idx) => {
                  const max = stats!.top_models[0]?.quantity || 1;
                  const pct = (m.quantity / max) * 100;
                  return (
                    <div key={m.vehicle_model_id} style={{
                      padding: '12px 16px',
                      borderBottom: idx < stats!.top_models.length - 1 ? '1px solid #f3f4f6' : 'none',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 24, height: 24, borderRadius: '50%',
                            background: idx === 0 ? '#fef3c7' : '#f3f4f6',
                            color:      idx === 0 ? '#92400e' : '#6b7280',
                            fontSize: 12, fontWeight: 700,
                          }}>{idx + 1}</span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.brand} {m.model_name}
                            </div>
                            <div style={{ fontSize: 11, color: '#6b7280' }}>
                              {formatCurrency(m.revenue)}
                            </div>
                          </div>
                        </div>
                        <span style={{
                          background: '#eff6ff', color: '#1d4ed8',
                          padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                          whiteSpace: 'nowrap', marginLeft: 8,
                        }}>
                          {m.quantity} xe
                        </span>
                      </div>
                      <div style={{ height: 5, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: idx === 0 ? '#f59e0b' : '#3b82f6',
                          borderRadius: 99, transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Đơn hàng gần đây ── */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">🕒 Đơn hàng gần đây</span>
              <Link to="/sales" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Xem tất cả →</Link>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {(stats?.recent_orders?.length ?? 0) === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  Chưa có đơn nào
                </div>
              ) : (
                stats!.recent_orders.map((o, idx) => {
                  const st = ORDER_STATUS[o.status];
                  return (
                    <div
                      key={o.id}
                      onClick={() => navigate(`/sales/${o.id}`)}
                      style={{
                        padding: '12px 16px',
                        borderBottom: idx < stats!.recent_orders.length - 1 ? '1px solid #f3f4f6' : 'none',
                        cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#2563eb' }}>
                            {o.order_number}
                          </span>
                          <span className={`badge ${st?.cls ?? 'badge-gray'}`} style={{ fontSize: 10 }}>
                            {st?.label ?? o.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.customers?.full_name || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          {formatDate(o.order_date)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>
                          {formatCurrency(o.total_amount)}
                        </div>
                        {o.deposit_amount > 0 && (
                          <div style={{ fontSize: 11, color: '#16a34a' }}>
                            Cọc: {formatCurrency(o.deposit_amount)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Shortcuts */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">🚀 Thao tác nhanh</span>
          </div>
          <div className="card-body" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10,
          }}>
            {[
              { href: '/sales/new',  label: '➕ Tạo đơn mới',         color: '#2563eb' },
              { href: '/customers',  label: '👤 Thêm khách hàng',      color: '#16a34a' },
              { href: '/services',   label: '🔧 Tạo phiếu dịch vụ',    color: '#d97706' },
              { href: '/finance',    label: '💸 Ghi nhận thu/chi',      color: '#7c3aed' },
            ].map(a => (
              <Link
                key={a.href} to={a.href}
                style={{
                  padding: '12px 14px', background: '#f9fafb', borderRadius: 8, textDecoration: 'none',
                  color: a.color, fontWeight: 600, fontSize: 13.5, border: '1px solid #e5e7eb',
                  display: 'block', textAlign: 'center', transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.borderColor = a.color;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#f9fafb';
                  e.currentTarget.style.borderColor = '#e5e7eb';
                }}
              >
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
