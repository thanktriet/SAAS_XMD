import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { formatCurrency, formatDate, ORDER_STATUS } from '../../utils/helpers';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { getCachedCustomer } from '../stores/offlineStore';
import { useState, useEffect } from 'react';
import type { Customer, SalesOrder } from '../../types';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isOnline = useNetworkStatus();
  const [offlineCustomer, setOfflineCustomer] = useState<any>(null);

  // Online: fetch from API
  const { data: customer, isLoading } = useQuery<Customer>({
    queryKey: ['m-customer-detail', id],
    queryFn: () => api.get(`/customers/${id}`).then(r => r.data),
    enabled: !!id && isOnline,
  });

  // Customer orders
  const { data: ordersResult } = useQuery<{ data: SalesOrder[]; total: number }>({
    queryKey: ['m-customer-orders', id],
    queryFn: () => api.get('/sales', { params: { customer_id: id, limit: 20 } }).then(r => r.data),
    enabled: !!id && isOnline,
  });

  // Offline fallback
  useEffect(() => {
    if (!isOnline && id) {
      getCachedCustomer(id).then(c => c && setOfflineCustomer(c));
    }
  }, [isOnline, id]);

  const data_ = customer || offlineCustomer;
  const orders = ordersResult?.data ?? [];

  if (isLoading && isOnline) {
    return (
      <div className="m-page-loader">
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (!data_) {
    return (
      <div className="m-placeholder">
        <span className="m-placeholder-icon">👤</span>
        <p>Không tìm thấy khách hàng</p>
      </div>
    );
  }

  return (
    <div className="m-page">
      {/* Info card */}
      <div className="m-card">
        <div className="m-customer-detail-header">
          <div className="m-customer-avatar-lg">
            {data_.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <h2 className="m-customer-name">{data_.full_name}</h2>
            {data_.customer_code && (
              <span className="m-customer-code">{data_.customer_code}</span>
            )}
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="m-card">
        <h3 className="m-card-title">Liên hệ</h3>
        <div className="m-info-row">
          <span>Điện thoại</span>
          {data_.phone ? (
            <a href={`tel:${data_.phone}`} className="m-link">📞 {data_.phone}</a>
          ) : <span>—</span>}
        </div>
        {data_.email && (
          <div className="m-info-row">
            <span>Email</span>
            <span>{data_.email}</span>
          </div>
        )}
        {data_.address && (
          <div className="m-info-row">
            <span>Địa chỉ</span>
            <span>{data_.address}</span>
          </div>
        )}

        {/* Quick action buttons */}
        <div className="m-contact-actions">
          {data_.phone && (
            <>
              <a href={`tel:${data_.phone}`} className="m-contact-btn">
                📞 Gọi
              </a>
              <a href={`sms:${data_.phone}`} className="m-contact-btn">
                💬 Nhắn tin
              </a>
            </>
          )}
        </div>
      </div>

      {/* Order history */}
      {isOnline && (
        <div className="m-card">
          <h3 className="m-card-title">Lịch sử mua hàng ({orders.length})</h3>
          {orders.length === 0 ? (
            <p className="m-card-sub">Chưa có đơn hàng</p>
          ) : (
            <div className="m-order-list-compact">
              {orders.map(order => (
                <div
                  key={order.id}
                  className="m-order-item-compact"
                  onClick={() => navigate(`/m/sales/${order.id}`)}
                >
                  <div className="m-order-item-left">
                    <span className="m-order-number">{order.order_number}</span>
                    <span className="m-order-date">{formatDate(order.order_date)}</span>
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
          )}
        </div>
      )}

      {!isOnline && (
        <div className="m-card">
          <p className="m-card-sub">📡 Offline — lịch sử mua hàng không khả dụng</p>
        </div>
      )}
    </div>
  );
}
