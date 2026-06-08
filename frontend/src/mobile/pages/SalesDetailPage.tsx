import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../services/api';
import { formatCurrency, formatDate, ORDER_STATUS, PAYMENT_METHOD, getAllowedActions } from '../../utils/helpers';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import StatusProgressBar from '../components/ui/StatusProgressBar';
import BottomSheet from '../components/ui/BottomSheet';
import type { ActionDef } from '../../utils/helpers';

export default function SalesDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const [activeSheet, setActiveSheet] = useState<ActionDef | null>(null);

  // Form states
  const [depositAmount, setDepositAmount] = useState('');
  const [paymentReceipt, setPaymentReceipt] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [pdiTechnician, setPdiTechnician] = useState('');
  const [pdiNote, setPdiNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');

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
    mutationFn: (payload: { status: string; meta?: Record<string, any> }) =>
      api.patch(`/sales/${id}/status`, {
        status: payload.status,
        ...payload.meta,
      }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['m-sales-detail', id] });
      qc.invalidateQueries({ queryKey: ['m-sales-payments', id] });
      qc.invalidateQueries({ queryKey: ['m-sales'] });
      setActiveSheet(null);
      resetForms();
      toast.success(`Đã chuyển: ${ORDER_STATUS[data.order?.status]?.label ?? data.order?.status}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật'),
  });

  const depositMut = useMutation({
    mutationFn: (amount: number) =>
      api.post(`/sales/${id}/payments`, { amount, payment_type: 'deposit' }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['m-sales-detail', id] });
      qc.invalidateQueries({ queryKey: ['m-sales-payments', id] });
      setActiveSheet(null);
      resetForms();
      toast.success('Đã ghi nhận đặt cọc');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi ghi nhận cọc'),
  });

  const paymentMut = useMutation({
    mutationFn: (data: { receipt_number: string; payment_date: string; note: string }) =>
      api.post(`/sales/${id}/payments`, {
        amount: remaining,
        payment_type: 'full_payment',
        ...data,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['m-sales-detail', id] });
      qc.invalidateQueries({ queryKey: ['m-sales-payments', id] });
      setActiveSheet(null);
      resetForms();
      toast.success('Đã ghi nhận thanh toán');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi thanh toán'),
  });

  function resetForms() {
    setDepositAmount('');
    setPaymentReceipt('');
    setPaymentDate('');
    setPaymentNote('');
    setPdiTechnician('');
    setPdiNote('');
    setCancelReason('');
  }

  function handleActionClick(action: ActionDef) {
    if (action.formType) {
      setActiveSheet(action);
    } else {
      // Direct status change with confirmation
      if (confirm(`Chuyển trạng thái sang "${ORDER_STATUS[action.toStatus]?.label || action.toStatus}"?`)) {
        statusMut.mutate({ status: action.toStatus });
      }
    }
  }

  function handleSheetSubmit() {
    if (!activeSheet) return;

    switch (activeSheet.formType) {
      case 'deposit': {
        const amount = Number(depositAmount);
        if (!amount || amount <= 0) { toast.error('Nhập số tiền hợp lệ'); return; }
        if (amount > (order?.total_amount || 0)) { toast.error('Số tiền vượt tổng đơn'); return; }
        depositMut.mutate(amount);
        break;
      }
      case 'payment': {
        if (!paymentReceipt.trim()) { toast.error('Nhập số biên lai'); return; }
        paymentMut.mutate({
          receipt_number: paymentReceipt,
          payment_date: paymentDate || new Date().toISOString().slice(0, 10),
          note: paymentNote,
        });
        break;
      }
      case 'pdi': {
        if (!pdiTechnician.trim()) { toast.error('Nhập tên kỹ thuật viên'); return; }
        if (pdiNote.length < 5 || pdiNote.length > 1000) { toast.error('Ghi chú phải từ 5-1000 ký tự'); return; }
        statusMut.mutate({
          status: activeSheet.toStatus,
          meta: { pdi_technician: pdiTechnician, pdi_notes: pdiNote },
        });
        break;
      }
      case 'cancel': {
        if (cancelReason.trim().length < 5) { toast.error('Nhập lý do (tối thiểu 5 ký tự)'); return; }
        statusMut.mutate({
          status: activeSheet.toStatus,
          meta: { cancel_reason: cancelReason },
        });
        break;
      }
    }
  }

  function handlePrint() {
    window.open(`/print-order.html?id=${id}`, '_blank');
  }

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
  const services = order.sales_order_services ?? [];
  const promotions = order.sales_order_promotions ?? [];
  const paymentList = Array.isArray(payments) ? payments : payments?.data ?? [];
  const totalPaid = paymentList.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, (order.total_amount || 0) - totalPaid);

  const actions = getAllowedActions(order.status, user?.role || '');
  const isPending = statusMut.isPending || depositMut.isPending || paymentMut.isPending;

  return (
    <div className="m-page m-detail-page">
      {/* Header card + progress bar */}
      <div className="m-card">
        <div className="m-detail-header">
          <div>
            <span className="m-order-number" style={{ fontSize: 16 }}>{order.order_number}</span>
            <span className="m-order-date" style={{ display: 'block', marginTop: 4 }}>
              {formatDate(order.order_date)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="m-header-action-btn" onClick={handlePrint} aria-label="In đơn hàng">
              🖨️
            </button>
            <span className={`m-badge m-badge-lg ${ORDER_STATUS[order.status]?.cls || ''}`}>
              {ORDER_STATUS[order.status]?.label || order.status}
            </span>
          </div>
        </div>
        <StatusProgressBar currentStatus={order.status} />
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
          ) : <span>—</span>}
        </div>
        {order.customers?.address && (
          <div className="m-info-row">
            <span>Địa chỉ</span>
            <span>{order.customers.address}</span>
          </div>
        )}
      </div>

      {/* Xe — mở rộng */}
      <div className="m-card">
        <h3 className="m-card-title">Xe</h3>
        {items.map((item: any, idx: number) => (
          <div key={idx}>
            <div className="m-info-row">
              <span>Model</span>
              <strong>🏍️ {item.vehicle_models?.brand} {item.vehicle_models?.model_name}</strong>
            </div>
            {item.inventory_vehicles?.color && (
              <div className="m-info-row">
                <span>Màu</span>
                <span>{item.inventory_vehicles.color}</span>
              </div>
            )}
            {item.inventory_vehicles?.vin && (
              <div className="m-info-row">
                <span>VIN</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.inventory_vehicles.vin}</span>
              </div>
            )}
            <div className="m-info-row">
              <span>Đơn giá</span>
              <span>{formatCurrency(item.unit_price || 0)} × {item.quantity}</span>
            </div>
          </div>
        ))}
        {order.salesperson_name && (
          <div className="m-info-row">
            <span>NV bán hàng</span>
            <strong>{order.salesperson_name}</strong>
          </div>
        )}
      </div>

      {/* Phụ kiện & Dịch vụ */}
      {(accessories.length > 0 || services.length > 0) && (
        <div className="m-card">
          <h3 className="m-card-title">Phụ kiện & Dịch vụ</h3>
          {accessories.length > 0 && (
            <>
              <p className="m-card-sub" style={{ marginBottom: 8, fontWeight: 600 }}>Phụ kiện:</p>
              {accessories.map((acc: any, idx: number) => (
                <div key={idx} className="m-product-item">
                  <div>
                    <span className="m-product-name">{acc.accessories?.name || acc.name || `#${acc.accessory_id}`}</span>
                    {acc.accessories?.sku && (
                      <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>{acc.accessories.sku}</span>
                    )}
                  </div>
                  <span className="m-product-price">
                    {formatCurrency(acc.unit_price)} × {acc.quantity}
                  </span>
                </div>
              ))}
            </>
          )}
          {services.length > 0 && (
            <>
              {accessories.length > 0 && <div className="m-divider" />}
              <p className="m-card-sub" style={{ marginBottom: 8, fontWeight: 600 }}>Dịch vụ/Phí:</p>
              {services.map((svc: any, idx: number) => (
                <div key={idx} className="m-product-item">
                  <div>
                    <span className="m-product-name">{svc.name}</span>
                    {svc.type && (
                      <span className="m-badge" style={{ marginLeft: 6, fontSize: 10 }}>{svc.type}</span>
                    )}
                  </div>
                  <strong>{formatCurrency(svc.amount || svc.price || 0)}</strong>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Khuyến mãi */}
      {promotions.length > 0 && (
        <div className="m-card">
          <h3 className="m-card-title">Khuyến mãi</h3>
          {promotions.map((promo: any, idx: number) => (
            <div key={idx} className="m-product-item">
              <div>
                <span className="m-product-name">{promo.promotions?.name || promo.name}</span>
                {promo.promotions?.type && (
                  <span className="m-badge" style={{ marginLeft: 6, fontSize: 10 }}>
                    {promo.promotions.type === 'percentage' ? '%' : promo.promotions.type === 'fixed' ? 'Cố định' : 'Quà'}
                  </span>
                )}
              </div>
              <span style={{ color: '#16a34a', fontWeight: 700 }}>
                -{formatCurrency(promo.discount_amount || promo.amount || 0)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Thanh toán */}
      <div className="m-card">
        <h3 className="m-card-title">Thanh toán</h3>
        <div className="m-info-row">
          <span>Tổng tiền hàng</span>
          <strong>{formatCurrency(order.subtotal || order.total_amount || 0)}</strong>
        </div>
        {order.discount_amount > 0 && (
          <div className="m-info-row">
            <span>Giảm giá</span>
            <span style={{ color: '#16a34a' }}>-{formatCurrency(order.discount_amount)}</span>
          </div>
        )}
        {order.tax_amount > 0 && (
          <div className="m-info-row">
            <span>Thuế</span>
            <span>{formatCurrency(order.tax_amount)}</span>
          </div>
        )}
        <div className="m-info-row m-total-row">
          <span>Tổng cộng</span>
          <strong>{formatCurrency(order.total_amount)}</strong>
        </div>
        <div className="m-divider" />
        <div className="m-info-row">
          <span>Phương thức</span>
          <span>{PAYMENT_METHOD[order.payment_method] || order.payment_method || '—'}</span>
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
            <p className="m-card-sub" style={{ marginBottom: 8, fontWeight: 600 }}>Lịch sử thanh toán:</p>
            {paymentList.map((p: any) => (
              <div key={p.id} className="m-payment-item">
                <div>
                  <span className="m-payment-date">{formatDate(p.payment_date || p.created_at)}</span>
                  {p.receipt_number && <span className="m-payment-note"> #{p.receipt_number}</span>}
                  {p.approved_by_name && (
                    <span className="m-payment-note"> • {p.approved_by_name}</span>
                  )}
                </div>
                <strong>{formatCurrency(p.amount)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Giao xe */}
      {(order.delivery_date || order.delivery_address) && (
        <div className="m-card">
          <h3 className="m-card-title">Giao xe</h3>
          {order.delivery_date && (
            <div className="m-info-row">
              <span>Ngày giao dự kiến</span>
              <span>{formatDate(order.delivery_date)}</span>
            </div>
          )}
          {order.delivery_address && (
            <div className="m-info-row">
              <span>Địa chỉ giao</span>
              <span>{order.delivery_address}</span>
            </div>
          )}
        </div>
      )}

      {/* Ghi chú */}
      {(order.notes || order.pdi_notes || order.cancel_reason) && (
        <div className="m-card">
          <h3 className="m-card-title">Ghi chú</h3>
          {order.notes && (
            <div className="m-info-row">
              <span>Ghi chú</span>
              <span>{order.notes}</span>
            </div>
          )}
          {order.pdi_notes && (
            <div className="m-info-row">
              <span>PDI</span>
              <span>{order.pdi_notes}</span>
            </div>
          )}
          {order.cancel_reason && (
            <div className="m-info-row">
              <span>Lý do huỷ</span>
              <span style={{ color: '#dc2626' }}>{order.cancel_reason}</span>
            </div>
          )}
        </div>
      )}

      {/* Action buttons — scrollable, show ALL */}
      {actions.length > 0 && (
        <div className="m-actions-bar-scroll">
          {actions.map(action => (
            <button
              key={action.toStatus}
              className={`m-action-btn-sm m-action-${action.variant}`}
              onClick={() => handleActionClick(action)}
              disabled={isPending}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Bottom Sheets ─── */}

      {/* Đặt cọc */}
      <BottomSheet
        open={activeSheet?.formType === 'deposit'}
        onClose={() => setActiveSheet(null)}
        title="Ghi nhận đặt cọc"
      >
        <div className="m-input-group">
          <label>Số tiền cọc</label>
          <input
            type="number"
            placeholder="Nhập số tiền..."
            value={depositAmount}
            onChange={e => setDepositAmount(e.target.value)}
            max={order?.total_amount}
            min={1}
          />
        </div>
        <button
          className="m-btn-primary"
          onClick={handleSheetSubmit}
          disabled={isPending}
        >
          {isPending ? 'Đang xử lý...' : 'Xác nhận cọc'}
        </button>
      </BottomSheet>

      {/* Thanh toán */}
      <BottomSheet
        open={activeSheet?.formType === 'payment'}
        onClose={() => setActiveSheet(null)}
        title="Thu đủ tiền"
      >
        <div className="m-input-group">
          <label>Số biên lai</label>
          <input
            type="text"
            placeholder="Nhập số biên lai..."
            value={paymentReceipt}
            onChange={e => setPaymentReceipt(e.target.value)}
          />
        </div>
        <div className="m-input-group">
          <label>Ngày thanh toán</label>
          <input
            type="date"
            value={paymentDate}
            onChange={e => setPaymentDate(e.target.value)}
          />
        </div>
        <div className="m-input-group">
          <label>Ghi chú</label>
          <textarea
            placeholder="Ghi chú thanh toán..."
            value={paymentNote}
            onChange={e => setPaymentNote(e.target.value)}
          />
        </div>
        <button
          className="m-btn-primary"
          onClick={handleSheetSubmit}
          disabled={isPending}
        >
          {isPending ? 'Đang xử lý...' : `Xác nhận — ${formatCurrency(remaining)}`}
        </button>
      </BottomSheet>

      {/* PDI */}
      <BottomSheet
        open={activeSheet?.formType === 'pdi'}
        onClose={() => setActiveSheet(null)}
        title="Xác nhận PDI"
      >
        <div className="m-input-group">
          <label>Kỹ thuật viên</label>
          <input
            type="text"
            placeholder="Tên kỹ thuật viên..."
            value={pdiTechnician}
            onChange={e => setPdiTechnician(e.target.value)}
          />
        </div>
        <div className="m-input-group">
          <label>Ghi chú kỹ thuật (5-1000 ký tự)</label>
          <textarea
            placeholder="Kết quả kiểm tra..."
            value={pdiNote}
            onChange={e => setPdiNote(e.target.value)}
            minLength={5}
            maxLength={1000}
          />
          <span style={{ fontSize: 11, color: '#64748b' }}>{pdiNote.length}/1000</span>
        </div>
        <button
          className="m-btn-primary"
          onClick={handleSheetSubmit}
          disabled={isPending}
        >
          {isPending ? 'Đang xử lý...' : 'Xác nhận PDI hoàn tất'}
        </button>
      </BottomSheet>

      {/* Huỷ đơn */}
      <BottomSheet
        open={activeSheet?.formType === 'cancel'}
        onClose={() => setActiveSheet(null)}
        title="Huỷ đơn hàng"
      >
        <div className="m-bottomsheet-warning">
          ⚠️ Đơn hàng sẽ bị huỷ{totalPaid > 0 && `, tiền cọc ${formatCurrency(totalPaid)} sẽ được hoàn`}.
        </div>
        <div className="m-input-group">
          <label>Lý do huỷ (bắt buộc)</label>
          <textarea
            placeholder="Nhập lý do huỷ đơn..."
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            minLength={5}
          />
        </div>
        <button
          className="m-btn-primary"
          style={{ background: '#dc2626' }}
          onClick={handleSheetSubmit}
          disabled={isPending}
        >
          {isPending ? 'Đang xử lý...' : '❌ Xác nhận huỷ đơn'}
        </button>
      </BottomSheet>
    </div>
  );
}
