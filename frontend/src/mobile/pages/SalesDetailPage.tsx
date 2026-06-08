import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../services/api';
import { formatCurrency, formatDate, ORDER_STATUS, PAYMENT_METHOD, getAllowedActions } from '../../utils/helpers';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

export default function SalesDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ['m-sales-detail', id],
    queryFn: () => api.get(`/sales/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ['m-sales-payments', id],
    queryFn: () => api.get(`/sales/${id}/payments`).then(r => r.data),
    enabled: !!id,
  });

  const statusMut = useMutation({
    mutationFn: (toStatus: string) =>
      api.patch(`/sales/${id}/status`, { status: toStatus }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['m-sales-detail', id] });
      qc.invalidateQueries({ queryKey: ['m-sales-payments', id] });
      qc.invalidateQueries({ queryKey: ['m-sales'] });
      setConfirmAction(null);
      toast.success(`Đã chuyển: ${ORDER_STATUS[data.order?.status]?.label ?? data.order?.status}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật'),
  });

  if (isLoading) {
    return (
      <div className="m-page-loader">
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="m-placeholder">
        <span className="m-placeholder-icon">❌</span>
        <p>Không tìm thấy đơn hàng</p>
      </div>
    );
  }

  const items = order.sales_order_items ?? [];
  const accessories = order.sales_order_accessories ?? [];
  const paymentList = Array.isArray(payments) ? payments : payments?.data ?? [];
  const totalPaid = paymentList.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, (order.total_amount || 0) - totalPaid);

  // Actions based on role and status
  const actions = getAllowedActions(order.status, user?.role || '');

  return (
    <div className="m-page m-detail-page">
      {/* Header card */}
      <div className="m-card">
        <div className="m-detail-header">
          <div>
            <span className="m-order-number" style={{ fontSize: 16 }}>{order.order_number}</span>
            <span className="m-order-date" style={{ display: 'block', marginTop: 4 }}>
              {formatDate(order.order_date)}
            </span>
          </div>
          <span className={`m-badge m-badge-lg ${ORDER_STATUS[order.status]?.cls || ''}`}>
            {ORDER_STATUS[order.status]?.label || order.status}
          </span>
        </div>
      </div>

      {/* Khách hàng */}
      <div className="m-card">
        <h3 className="m-card-title">Khách hàng</h3>
        <div className="m-info-row">
          <span>Tên</span>
          <strong>{order.customers?.full_name || '—'}</strong>
        </div>
        <div className="m-info-row">
          <span>SĐT</span>
          {order.customers?.phone ? (
            <a href={`tel:${order.customers.phone}`} className="m-link">
              📞 {order.customers.phone}
            </a>
          ) : (
            <span>—</span>
          )}
        </div>
        {order.customers?.address && (
          <div className="m-info-row">
            <span>Địa chỉ</span>
            <span>{order.customers.address}</span>
          </div>
        )}
      </div>

      {/* Sản phẩm */}
      <div className="m-card">
        <h3 className="m-card-title">Sản phẩm</h3>
        {items.map((item: any, idx: number) => (
          <div key={idx} className="m-product-item">
            <div className="m-product-name">
              🏍️ {item.vehicle_models?.brand} {item.vehicle_models?.model_name}
              {item.inventory_vehicles?.color && ` — ${item.inventory_vehicles.color}`}
            </div>
            <div className="m-product-price">
              {formatCurrency(item.unit_price || 0)} × {item.quantity}
            </div>
          </div>
        ))}
        {accessories.length > 0 && (
          <>
            <div className="m-divider" />
            <p className="m-card-sub" style={{ marginBottom: 8 }}>Phụ kiện:</p>
            {accessories.map((acc: any, idx: number) => (
              <div key={idx} className="m-product-item">
                <span>{acc.accessories?.name || `#${acc.accessory_id}`}</span>
                <span>{formatCurrency(acc.unit_price)} × {acc.quantity}</span>
              </div>
            ))}
          </>
        )}
        <div className="m-divider" />
        <div className="m-info-row m-total-row">
          <span>Tổng cộng</span>
          <strong>{formatCurrency(order.total_amount)}</strong>
        </div>
        {order.discount_amount > 0 && (
          <div className="m-info-row">
            <span>Giảm giá</span>
            <span style={{ color: '#16a34a' }}>-{formatCurrency(order.discount_amount)}</span>
          </div>
        )}
      </div>

      {/* Thanh toán */}
      <div className="m-card">
        <h3 className="m-card-title">Thanh toán</h3>
        <div className="m-info-row">
          <span>Phương thức</span>
          <span>{PAYMENT_METHOD[order.payment_method] || order.payment_method}</span>
        </div>
        <div className="m-info-row">
          <span>Đã thanh toán</span>
          <strong style={{ color: '#16a34a' }}>{formatCurrency(totalPaid)}</strong>
        </div>
        <div className="m-info-row">
          <span>Còn lại</span>
          <strong style={{ color: remaining > 0 ? '#dc2626' : '#16a34a' }}>
            {formatCurrency(remaining)}
          </strong>
        </div>

        {paymentList.length > 0 && (
          <>
            <div className="m-divider" />
            <p className="m-card-sub" style={{ marginBottom: 8 }}>Lịch sử:</p>
            {paymentList.map((p: any) => (
              <div key={p.id} className="m-payment-item">
                <div>
                  <span className="m-payment-date">{formatDate(p.payment_date || p.created_at)}</span>
                  {p.receipt_number && <span className="m-payment-note"> #{p.receipt_number}</span>}
                </div>
                <strong>{formatCurrency(p.amount)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Action buttons — sticky bottom */}
      {actions.length > 0 && order.status !== 'cancelled' && order.status !== 'delivered' && (
        <div className="m-actions-bar">
          {actions.slice(0, 2).map(action => (
            <button
              key={action.toStatus}
              className={`m-action-btn${action.toStatus === 'cancelled' ? ' m-action-danger' : ' m-action-primary'}`}
              onClick={() => setConfirmAction(action.toStatus)}
              disabled={statusMut.isPending}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <div className="m-modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="m-modal" onClick={e => e.stopPropagation()}>
            <h3>Xác nhận</h3>
            <p>
              Chuyển trạng thái sang <strong>{ORDER_STATUS[confirmAction]?.label || confirmAction}</strong>?
            </p>
            <div className="m-modal-actions">
              <button className="m-btn-secondary" onClick={() => setConfirmAction(null)}>
                Huỷ
              </button>
              <button
                className="m-btn-primary"
                onClick={() => statusMut.mutate(confirmAction)}
                disabled={statusMut.isPending}
              >
                {statusMut.isPending ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
