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

  const isBusiness = data_.customer_type === 'business';

  return (
    <div className="m-page m-detail-page">
      {/* Header info card */}
      <div className="m-card">
        <div className="m-customer-detail-header">
          <div className="m-customer-avatar-lg">
            {data_.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="m-customer-name">{data_.full_name}</h2>
              {data_.customer_type && (
                <span className={`m-customer-type-badge${isBusiness ? ' business' : ''}`}>
                  {isBusiness ? 'Doanh nghiệp' : 'Cá nhân'}
                </span>
              )}
            </div>
            {data_.customer_code && (
              <span className="m-customer-code">{data_.customer_code}</span>
            )}
            {data_.loyalty_points > 0 && (
              <span className="m-customer-points" style={{ marginLeft: 8 }}>
                ⭐ {data_.loyalty_points} điểm
              </span>
            )}
          </div>
          {/* Edit button */}
          <button
            className="m-header-action-btn"
            onClick={() => navigate(`/m/customers/${id}/edit`)}
            aria-label="Sửa khách hàng"
          >
            ✏️
          </button>
        </div>
      </div>

      {/* Thông tin cá nhân */}
      <div className="m-card">
        <h3 className="m-card-title">Thông tin</h3>
        {data_.gender && (
          <div className="m-info-row">
            <span>Giới tính</span>
            <span>{data_.gender === 'male' ? 'Nam' : data_.gender === 'female' ? 'Nữ' : 'Khác'}</span>
          </div>
        )}
        {data_.date_of_birth && (
          <div className="m-info-row">
            <span>Ngày sinh</span>
            <span>{formatDate(data_.date_of_birth)}</span>
          </div>
        )}
        {data_.source && (
          <div className="m-info-row">
            <span>Nguồn KH</span>
            <span>{data_.source}</span>
          </div>
        )}
        {data_.id_card && (
          <div className="m-info-row">
            <span>CMND/CCCD</span>
            <span>{data_.id_card}</span>
          </div>
        )}
        {data_.id_card_date && (
          <div className="m-info-row">
            <span>Ngày cấp</span>
            <span>{formatDate(data_.id_card_date)}</span>
          </div>
        )}
        {data_.id_card_place && (
          <div className="m-info-row">
            <span>Nơi cấp</span>
            <span>{data_.id_card_place}</span>
          </div>
        )}
      </div>

      {/* Liên hệ */}
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

      {/* Địa chỉ */}
      {(data_.address || data_.invoice_address) && (
        <div className="m-card">
          <h3 className="m-card-title">Địa chỉ</h3>
          {data_.address && (
            <div className="m-info-row">
              <span>Giao hàng</span>
              <span>{data_.address}{data_.district ? `, ${data_.district}` : ''}{data_.province ? `, ${data_.province}` : ''}</span>
            </div>
          )}
          {data_.invoice_address && (
            <div className="m-info-row">
              <span>Hoá đơn</span>
              <span>{data_.invoice_address}{data_.invoice_district ? `, ${data_.invoice_district}` : ''}{data_.invoice_province ? `, ${data_.invoice_province}` : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Thông tin doanh nghiệp (chỉ hiện khi loại = DN) */}
      {isBusiness && (
        <div className="m-card">
          <h3 className="m-card-title">Doanh nghiệp</h3>
          {data_.company_name && (
            <div className="m-info-row">
              <span>Công ty</span>
              <strong>{data_.company_name}</strong>
            </div>
          )}
          {data_.tax_code && (
            <div className="m-info-row">
              <span>Mã số thuế</span>
              <span>{data_.tax_code}</span>
            </div>
          )}
          {data_.representative_name && (
            <div className="m-info-row">
              <span>Người đại diện</span>
              <span>{data_.representative_name}</span>
            </div>
          )}
          {data_.representative_title && (
            <div className="m-info-row">
              <span>Chức vụ</span>
              <span>{data_.representative_title}</span>
            </div>
          )}
        </div>
      )}

      {/* Ghi chú */}
      {data_.notes && (
        <div className="m-card">
          <h3 className="m-card-title">Ghi chú</h3>
          <p style={{ fontSize: 14, margin: 0, color: '#1e293b', lineHeight: 1.5 }}>{data_.notes}</p>
        </div>
      )}

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
