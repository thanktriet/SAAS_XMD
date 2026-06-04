// Trang Đơn hàng
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../services/api';
import type { SalesOrder, PaginatedResponse } from '../types';
import {
  formatCurrency, formatDate,
  ORDER_STATUS, ORDER_STATUS_STEPS, PAYMENT_METHOD,
  getAllowedActions,
  type ActionDef,
} from '../utils/helpers';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

// ─── Kiểu form nhập khi chuyển trạng thái ────────────────────────────────────
interface FormData {
  deposit_amount: string;
  receipt_number: string;
  receipt_date:   string;
  payment_note:   string;
  pdi_notes:      string;
  cancel_reason:  string;
}

const EMPTY_FORM: FormData = {
  deposit_amount: '',
  receipt_number: '',
  receipt_date:   new Date().toISOString().split('T')[0],
  payment_note:   '',
  pdi_notes:      '',
  cancel_reason:  '',
};

// ─── Thanh tiến trình ─────────────────────────────────────────────────────────
function StatusProgressBar({ currentStatus }: { currentStatus: string }) {
  const isCancelled = currentStatus === 'cancelled';
  // Bỏ invoice_approved (bước trung gian tự động) và deposit_paid (đã hiển thị ở phần thanh toán)
  const DISPLAY_STEPS = ORDER_STATUS_STEPS.filter(s => s !== 'invoice_approved' && s !== 'deposit_paid');
  // Map các trạng thái ẩn về bước tương đương đang hiển thị
  const displayStatus = currentStatus === 'invoice_approved' ? 'invoice_requested'
                      : currentStatus === 'deposit_paid'     ? 'confirmed'
                      : currentStatus;
  const currentIdx  = DISPLAY_STEPS.indexOf(displayStatus as any);

  return (
    <div className="order-progress-bar">
      {DISPLAY_STEPS.map((step, idx) => {
        const isDone    = !isCancelled && idx < currentIdx;
        const isActive  = !isCancelled && displayStatus === step;
        const isPending = !isCancelled && idx > currentIdx;
        return (
          <div
            key={step}
            className={`order-progress-step${isDone ? ' done' : ''}${isActive ? ' active' : ''}${isPending ? ' pending' : ''}`}
          >
            <div className="order-progress-dot">
              {isDone ? '✓' : idx + 1}
            </div>
            <div className="order-progress-label">
              {ORDER_STATUS[step]?.label ?? step}
            </div>
            {idx < DISPLAY_STEPS.length - 1 && (
              <div className={`order-progress-line${isDone ? ' done' : ''}`} />
            )}
          </div>
        );
      })}
      {isCancelled && (
        <div className="order-progress-cancelled">❌ Đơn đã huỷ</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function SalesPage() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const userRole = user?.role ?? '';

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]                 = useState(1);
  const [detailId, setDetailId]         = useState<string | null>(null);

  // State modal
  const [activeForm, setActiveForm]       = useState<ActionDef['formType']>(null);
  const [formData, setFormData]           = useState<FormData>(EMPTY_FORM);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<PaginatedResponse<SalesOrder>>({
    queryKey: ['sales', statusFilter, page],
    queryFn: () =>
      api.get('/sales', { params: { status: statusFilter || undefined, page, limit: 15 } })
        .then(r => r.data),
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['sales-detail', detailId],
    queryFn: () => api.get(`/sales/${detailId}`).then(r => r.data),
    enabled: !!detailId,
  });

  // ── Mutation ──────────────────────────────────────────────────────────
  const statusMut = useMutation({
    mutationFn: ({ toStatus, extra }: { toStatus: string; extra?: Record<string, unknown> }) =>
      api.patch(`/sales/${detailId}/status`, { status: toStatus, ...extra }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales-detail', detailId] });
      setActiveForm(null);
      setFormData(EMPTY_FORM);
      setConfirmCancel(false);
      toast.success(`Đã chuyển: ${ORDER_STATUS[data.order?.status]?.label ?? data.order?.status}`);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || 'Lỗi cập nhật trạng thái'),
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);

  // ── Xuất Excel toàn bộ đơn hàng (kể cả filter trạng thái nếu có) ─────────
  const [dangXuat, setDangXuat] = useState(false);
  async function xuatExcel() {
    if (dangXuat) return;
    try {
      setDangXuat(true);
      // Lấy hết — page=1, limit lớn
      const params: Record<string, any> = { page: 1, limit: 10000 };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/sales', { params });
      const list: SalesOrder[] = res.data?.data ?? [];
      if (list.length === 0) {
        toast.error('Không có đơn hàng nào để xuất');
        return;
      }

      const rows = list.map((o, idx) => {
        const items = o.sales_order_items ?? [];
        const firstItem = items[0];
        const tenXe = firstItem
          ? `${firstItem.vehicle_models?.brand ?? ''} ${firstItem.vehicle_models?.model_name ?? ''}`.trim()
          : '';
        const xeThem = items.length > 1 ? ` (+${items.length - 1} xe khác)` : '';
        const conLai = Math.max(0, (o.total_amount ?? 0) - (o.deposit_amount ?? 0));

        return {
          'STT':            idx + 1,
          'Mã đơn':         o.order_number,
          'Ngày đặt':       formatDate(o.order_date),
          'Khách hàng':     o.customers?.full_name ?? '',
          'SĐT khách':      o.customers?.phone ?? '',
          'Mẫu xe':         tenXe + xeThem,
          'Màu':            firstItem?.inventory_vehicles?.color ?? '',
          'Số khung (VIN)': firstItem?.inventory_vehicles?.vin ?? '',
          'Nhân viên':      o.users?.full_name ?? '',
          'Tổng tiền':      o.total_amount ?? 0,
          'Đã thu':         o.deposit_amount ?? 0,
          'Còn lại':        conLai,
          'Phương thức':    PAYMENT_METHOD[o.payment_method] ?? o.payment_method ?? '',
          'Số HĐ trả góp':  o.payment_method === 'installment' ? (o.installment_contract_number ?? '') : '',
          'Ngày giao':      o.delivery_date ? formatDate(o.delivery_date) : '',
          'Trạng thái':     ORDER_STATUS[o.status]?.label ?? o.status,
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      // Auto width đẹp hơn
      ws['!cols'] = [
        { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 14 },
        { wch: 26 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
        { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 16 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Đơn hàng');

      const ngay = new Date().toISOString().slice(0, 10);
      const tenFile = `don-hang-${ngay}${statusFilter ? '-' + statusFilter : ''}.xlsx`;
      XLSX.writeFile(wb, tenFile);
      toast.success(`✅ Đã xuất ${list.length} đơn ra ${tenFile}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Lỗi xuất Excel');
    } finally {
      setDangXuat(false);
    }
  }

  // ── Xử lý submit action ──────────────────────────────────────────────
  function handleAction(action: ActionDef) {
    if (action.toStatus === 'draft' && detail?.status !== 'draft') {
      const ok = confirm(
        `Mở lại đơn ${detail?.order_number}?\n` +
        `Lịch sử thanh toán + tiền cọc được giữ nguyên.`
      );
      if (!ok) return;
      statusMut.mutate({ toStatus: 'draft' });
      return;
    }
    if (!action.formType) {
      // Không cần form, confirm trực tiếp
      statusMut.mutate({ toStatus: action.toStatus });
      return;
    }
    setActiveForm(action.formType);
    setConfirmCancel(false);
  }

  function handleFormSubmit() {
    if (!activeForm) return;
    let extra: Record<string, unknown> = {};

    switch (activeForm) {
      case 'deposit':
        if (!formData.deposit_amount) { toast.error('Nhập số tiền cọc'); return; }
        extra = { deposit_amount: parseFloat(formData.deposit_amount.replace(/\D/g, '')) };
        statusMut.mutate({ toStatus: 'deposit_paid', extra });
        break;

      case 'payment':
        if (!formData.receipt_number.trim()) { toast.error('Nhập số phiếu thu'); return; }
        if (!formData.receipt_date)          { toast.error('Chọn ngày thu tiền'); return; }
        extra = {
          receipt_number: formData.receipt_number.trim(),
          receipt_date:   formData.receipt_date,
          payment_note:   formData.payment_note.trim() || undefined,
        };
        statusMut.mutate({ toStatus: 'full_paid', extra });
        break;

      case 'pdi':
        if (formData.pdi_notes.trim().length < 5) { toast.error('Ghi chú PDI tối thiểu 5 ký tự'); return; }
        extra = { pdi_notes: formData.pdi_notes.trim() };
        statusMut.mutate({ toStatus: 'pdi_done', extra });
        break;

      case 'cancel':
        if (!confirmCancel) { setConfirmCancel(true); return; }
        if (formData.cancel_reason.trim().length < 5) { toast.error('Lý do huỷ tối thiểu 5 ký tự'); return; }
        extra = { cancel_reason: formData.cancel_reason.trim() };
        statusMut.mutate({ toStatus: 'cancelled', extra });
        break;
    }
  }

  function closeModal() {
    setDetailId(null);
    setActiveForm(null);
    setFormData(EMPTY_FORM);
    setConfirmCancel(false);
  }

  // ── Tính tiền còn lại ────────────────────────────────────────────────
  const conLai = detail
    ? Math.max(0, (detail.total_amount ?? 0) - (detail.deposit_amount ?? 0))
    : 0;

  // Các hành động cho user hiện tại
  const allowedActions: ActionDef[] = detail
    ? getAllowedActions(detail.status, userRole)
    : [];

  // ════════════════════════════════════════════════════════════════════════
  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🛒 Quản lý Đơn hàng</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={xuatExcel} disabled={dangXuat}>
            {dangXuat ? '⏳ Đang xuất...' : '📊 Xuất Excel'}
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/sales/new')}>
            + Tạo đơn mới
          </button>
        </div>
      </div>

      <div className="page-content">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Danh sách đơn hàng ({data?.total ?? 0})</span>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">Tất cả trạng thái</option>
              {Object.entries(ORDER_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : (data?.data?.length ?? 0) === 0 ? (
              <div className="empty-state"><p>Không có đơn hàng nào</p></div>
            ) : (
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th>Mã đơn</th><th>Khách hàng</th>
                    <th className="hide-mobile">Mẫu xe</th>
                    <th className="hide-mobile">Màu</th>
                    <th className="hide-mobile">Số khung (VIN)</th>
                    <th className="hide-mobile">Nhân viên</th>
                    <th>Tổng tiền</th><th className="hide-mobile">Thanh toán</th><th className="hide-mobile">Ngày đặt</th>
                    <th>Trạng thái</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map(o => {
                    const items = o.sales_order_items ?? [];
                    const firstItem = items[0];
                    const moTaXe = firstItem
                      ? `${firstItem.vehicle_models?.brand ?? ''} ${firstItem.vehicle_models?.model_name ?? ''}`.trim() || '-'
                      : '-';
                    const xeThem = items.length > 1 ? ` +${items.length - 1}` : '';
                    const mauXe = firstItem?.inventory_vehicles?.color || '-';
                    const vinXe = firstItem?.inventory_vehicles?.vin || '-';
                    return (
                    <tr key={o.id}>
                      <td><span className="font-mono text-primary">{o.order_number}</span></td>
                      <td data-label="Khách hàng" className="fw-600">
                        {o.customers?.full_name}
                        <br />
                        <span className="text-muted" style={{ fontWeight: 400 }}>{o.customers?.phone}</span>
                      </td>
                      <td data-label="Mẫu xe" className="hide-mobile fw-600">
                        {moTaXe}
                        {xeThem && <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>{xeThem}</span>}
                      </td>
                      <td data-label="Màu" className="hide-mobile">{mauXe}</td>
                      <td data-label="VIN" className="hide-mobile">
                        <span className="font-mono" style={{ fontSize: 11 }}>{vinXe}</span>
                      </td>
                      <td data-label="Nhân viên" className="text-muted hide-mobile">{o.users?.full_name || '-'}</td>
                      <td data-label="Tổng tiền" className="fw-600">{formatCurrency(o.total_amount)}</td>
                      <td data-label="Thanh toán" className="hide-mobile">
                        <span className="badge badge-gray">
                          {PAYMENT_METHOD[o.payment_method] || o.payment_method}
                        </span>
                      </td>
                      <td data-label="Ngày đặt" className="text-muted hide-mobile">{formatDate(o.order_date)}</td>
                      <td data-label="Trạng thái">
                        <span className={`badge ${ORDER_STATUS[o.status]?.cls || 'badge-gray'}`}>
                          {ORDER_STATUS[o.status]?.label || o.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => navigate(`/sales/${o.id}`)}
                        >
                          👁️ Chi tiết
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">Trang {page}/{totalPages} · {data?.total} đơn</span>
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════ MODAL CHI TIẾT ════════════════ */}
      {detailId && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                📋 Chi tiết đơn hàng{detail ? ` #${detail.order_number}` : ''}
              </span>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>

            {/* Loading */}
            {loadingDetail && (
              <div className="modal-body">
                <div className="loading-center" style={{ minHeight: 200 }}><div className="spinner" /></div>
              </div>
            )}

            {!loadingDetail && detail && (
              <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

                {/* ── Thanh tiến trình ── */}
                <StatusProgressBar currentStatus={detail.status} />

                {/* ── Badge trạng thái hiện tại ── */}
                <div className="order-detail-status-bar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="text-muted" style={{ fontSize: 13 }}>Trạng thái hiện tại:</span>
                    <span className={`badge ${ORDER_STATUS[detail.status]?.cls || 'badge-gray'}`} style={{ fontSize: 13 }}>
                      {ORDER_STATUS[detail.status]?.label || detail.status}
                    </span>
                  </div>
                  <span className="text-muted" style={{ fontSize: 12 }}>{detail.order_number}</span>
                </div>

                {/* ── Thông tin chung ── */}
                <p className="form-section-title">Thông tin đơn hàng</p>
                <div className="order-detail-grid">
                  <div className="order-detail-col">
                    <div className="order-detail-item">
                      <span className="order-detail-label">Mã đơn hàng</span>
                      <span className="order-detail-val font-mono text-primary fw-600">{detail.order_number}</span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Ngày đặt hàng</span>
                      <span className="order-detail-val">{formatDate(detail.order_date)}</span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Ngày giao xe dự kiến</span>
                      <span className="order-detail-val">{detail.delivery_date ? formatDate(detail.delivery_date) : '-'}</span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Phương thức thanh toán</span>
                      <span className="order-detail-val">{PAYMENT_METHOD[detail.payment_method] || '-'}</span>
                    </div>
                  </div>
                  <div className="order-detail-col">
                    <div className="order-detail-item">
                      <span className="order-detail-label">Khách hàng</span>
                      <span className="order-detail-val fw-600">{detail.customers?.full_name || '-'}</span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Số điện thoại</span>
                      <span className="order-detail-val">{detail.customers?.phone || '-'}</span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Email khách</span>
                      <span className="order-detail-val text-muted">{detail.customers?.email || '-'}</span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Nhân viên bán hàng</span>
                      <span className="order-detail-val">{detail.users?.full_name || '-'}</span>
                    </div>
                  </div>
                </div>
                {detail.delivery_address && (
                  <div className="order-detail-item" style={{ marginTop: 4, marginBottom: 8 }}>
                    <span className="order-detail-label">Địa chỉ giao xe</span>
                    <span className="order-detail-val">📍 {detail.delivery_address}</span>
                  </div>
                )}

                {/* ── Bảng xe ── */}
                <p className="form-section-title">Xe trong đơn hàng</p>
                <div className="table-wrap" style={{ marginBottom: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Mẫu xe</th><th>Màu</th><th>Số khung (VIN)</th>
                        <th style={{ textAlign: 'center' }}>SL</th>
                        <th style={{ textAlign: 'right' }}>Đơn giá</th>
                        <th style={{ textAlign: 'right' }}>Giảm (%)</th>
                        <th style={{ textAlign: 'right' }}>Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.sales_order_items ?? []).length === 0 ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', color: '#6b7280' }}>Không có dữ liệu</td></tr>
                      ) : detail.sales_order_items.map((item: any, idx: number) => {
                        const isFirst = idx === 0;
                        const orderKM = Number(detail.discount_amount ?? 0);
                        const itemPct = Number(item.discount_percent ?? 0);
                        const itemLineTotal = Number(item.line_total ?? 0);
                        const showOrderKM = isFirst && orderKM > 0 && !(itemPct > 0);
                        const sauKM = Math.max(0, itemLineTotal - (showOrderKM ? orderKM : 0));
                        return (
                        <tr key={item.id}>
                          <td className="fw-600">{item.vehicle_models?.brand} {item.vehicle_models?.model_name}</td>
                          <td>{item.inventory_vehicles?.color || '-'}</td>
                          <td><span className="font-mono" style={{ fontSize: 12 }}>{item.inventory_vehicles?.vin || '-'}</span></td>
                          <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(item.unit_price)}</td>
                          <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>
                            {itemPct > 0
                              ? `${itemPct}%`
                              : (showOrderKM ? `-${formatCurrency(orderKM)}` : '-')}
                          </td>
                          <td style={{ textAlign: 'right' }} className="fw-600">
                            {showOrderKM ? (
                              <>
                                <div style={{ textDecoration: 'line-through', color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>
                                  {formatCurrency(itemLineTotal)}
                                </div>
                                <div>{formatCurrency(sauKM)}</div>
                              </>
                            ) : formatCurrency(itemLineTotal)}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── Phụ kiện ── */}
                {(detail.sales_order_accessories ?? []).length > 0 && (
                  <>
                    <p className="form-section-title">Phụ kiện đi kèm</p>
                    <div className="table-wrap" style={{ marginBottom: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Phụ kiện</th><th>Mã</th>
                            <th style={{ textAlign: 'center' }}>SL</th>
                            <th style={{ textAlign: 'right' }}>Đơn giá</th>
                            <th style={{ textAlign: 'right' }}>Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sales_order_accessories.map((acc: any) => (
                            <tr key={acc.id}>
                              <td className="fw-600">{acc.accessories?.name || '-'}</td>
                              <td><span className="font-mono text-muted" style={{ fontSize: 12 }}>{acc.accessories?.code || '-'}</span></td>
                              <td style={{ textAlign: 'center' }}>{acc.quantity}</td>
                              <td style={{ textAlign: 'right' }}>{formatCurrency(acc.unit_price)}</td>
                              <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(acc.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* ── Khuyến mãi ── */}
                {(detail.sales_order_promotions ?? []).length > 0 && (
                  <>
                    <p className="form-section-title">Chương trình khuyến mãi</p>
                    <div className="table-wrap" style={{ marginBottom: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Tên chương trình</th>
                            <th>Loại</th>
                            <th style={{ textAlign: 'right' }}>Ưu đãi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sales_order_promotions.map((p: any) => (
                            <tr key={p.id}>
                              <td className="fw-600">{p.promo_name}</td>
                              <td>
                                <span style={{
                                  background: p.promo_type === 'percent' ? '#dbeafe'
                                    : p.promo_type === 'fixed' ? '#dcfce7'
                                    : '#ede9fe',
                                  color: p.promo_type === 'percent' ? '#1d4ed8'
                                    : p.promo_type === 'fixed' ? '#15803d'
                                    : '#6d28d9',
                                  padding: '2px 8px', borderRadius: 999, fontSize: 12,
                                }}>
                                  {p.promo_type === 'percent' ? 'Giảm %'
                                    : p.promo_type === 'fixed' ? 'Giảm tiền'
                                    : p.promo_type === 'gift'  ? 'Quà tặng'
                                    : 'Combo'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {(p.promo_type === 'gift' || p.promo_type === 'combo')
                                  ? <span style={{ color: '#6d28d9' }}>🎁 {p.gift_item_name} ×{p.gift_quantity}</span>
                                  : <span className="text-danger fw-600">-{formatCurrency(p.discount_amount)}</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* ── Phí & Dịch vụ ── */}
                {((detail.sales_order_fees ?? []).length > 0 || (detail.sales_order_services ?? []).length > 0) && (
                  <>
                    <p className="form-section-title">Phí & Dịch vụ đăng ký</p>
                    <div className="table-wrap" style={{ marginBottom: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Nội dung</th>
                            <th>Loại</th>
                            <th style={{ textAlign: 'right' }}>Số tiền</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.sales_order_fees ?? []).map((f: any) => (
                            <tr key={f.id}>
                              <td className="fw-600">{f.fee_label}</td>
                              <td><span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>Phí</span></td>
                              <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(f.amount)}</td>
                            </tr>
                          ))}
                          {(detail.sales_order_services ?? []).map((s: any) => (
                            <tr key={s.id}>
                              <td className="fw-600">{s.service_name}</td>
                              <td><span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>Dịch vụ</span></td>
                              <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(s.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* ── Tổng tiền ── */}
                <p className="form-section-title">Thanh toán</p>
                <div className="order-detail-payment">
                  <div className="order-payment-row">
                    <span>Tạm tính</span><span>{formatCurrency(detail.subtotal)}</span>
                  </div>
                  {(detail.discount_amount ?? 0) > 0 && (
                    <div className="order-payment-row text-danger">
                      <span>Chiết khấu</span><span>-{formatCurrency(detail.discount_amount)}</span>
                    </div>
                  )}
                  {(detail.tax_amount ?? 0) > 0 && (
                    <div className="order-payment-row">
                      <span>Thuế / phí</span><span>{formatCurrency(detail.tax_amount)}</span>
                    </div>
                  )}
                  <div className="order-payment-row order-payment-total">
                    <span>Tổng cộng</span><span>{formatCurrency(detail.total_amount)}</span>
                  </div>
                  {(detail.deposit_amount ?? 0) > 0 && (
                    <>
                      <div className="order-payment-row" style={{ color: '#16a34a' }}>
                        <span>Đã thu (đặt cọc)</span><span>-{formatCurrency(detail.deposit_amount)}</span>
                      </div>
                      <div className="order-payment-row" style={{ fontWeight: 600, color: conLai > 0 ? '#dc2626' : '#16a34a' }}>
                        <span>{conLai > 0 ? 'Còn lại phải thu' : '✅ Đã thanh toán đủ'}</span>
                        <span>{formatCurrency(conLai)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* ── Thông tin bổ sung theo lịch sử ── */}
                {detail.receipt_number && (
                  <div className="order-meta-section">
                    <p className="form-section-title">Thông tin phiếu thu</p>
                    <div className="order-detail-grid">
                      <div className="order-detail-col">
                        <div className="order-detail-item">
                          <span className="order-detail-label">Số phiếu thu</span>
                          <span className="order-detail-val fw-600 font-mono">{detail.receipt_number}</span>
                        </div>
                        <div className="order-detail-item">
                          <span className="order-detail-label">Ngày thu tiền</span>
                          <span className="order-detail-val">{formatDate(detail.receipt_date)}</span>
                        </div>
                      </div>
                      <div className="order-detail-col">
                        {detail.payment_note && (
                          <div className="order-detail-item">
                            <span className="order-detail-label">Ghi chú thanh toán</span>
                            <span className="order-detail-val">{detail.payment_note}</span>
                          </div>
                        )}
                        {detail.approved_by_user && (
                          <div className="order-detail-item">
                            <span className="order-detail-label">Người duyệt hoá đơn</span>
                            <span className="order-detail-val">✅ {detail.approved_by_user?.full_name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {detail.pdi_notes && (
                  <div className="order-meta-section">
                    <p className="form-section-title">Kết quả kiểm định PDI</p>
                    <div className="order-detail-grid">
                      <div className="order-detail-col">
                        {detail.technician && (
                          <div className="order-detail-item">
                            <span className="order-detail-label">Kỹ thuật viên</span>
                            <span className="order-detail-val fw-600">🔧 {detail.technician?.full_name}</span>
                          </div>
                        )}
                      </div>
                      <div className="order-detail-col">
                        <div className="order-detail-item">
                          <span className="order-detail-label">Ghi chú PDI</span>
                          <span className="order-detail-val">{detail.pdi_notes}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {detail.status === 'cancelled' && detail.cancel_reason && (
                  <div className="order-meta-section order-meta-cancelled">
                    <p className="form-section-title" style={{ color: '#dc2626' }}>Lý do huỷ đơn</p>
                    <p style={{ margin: 0, fontSize: 14 }}>{detail.cancel_reason}</p>
                  </div>
                )}

                {detail.notes && (
                  <>
                    <p className="form-section-title">Ghi chú đơn hàng</p>
                    <div className="order-detail-notes">{detail.notes}</div>
                  </>
                )}

                {/* ── Action Panel ── */}
                {allowedActions.length > 0 && (
                  <div className="order-action-panel">
                    <p className="form-section-title">Thao tác</p>

                    {/* Nút hành động */}
                    {!activeForm && (
                      <div className="order-action-btns">
                        {allowedActions.map(action => (
                          <button
                            key={action.toStatus}
                            className={`btn ${action.variant === 'danger' ? 'btn-danger' : action.variant === 'warning' ? 'btn-warning' : 'btn-primary'}`}
                            onClick={() => handleAction(action)}
                            disabled={statusMut.isPending}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Sub-form: đặt cọc */}
                    {activeForm === 'deposit' && (
                      <div className="order-subform">
                        <p className="order-subform-title">💰 Ghi nhận đặt cọc</p>
                        <div className="form-group">
                          <label className="form-label">Số tiền cọc <span className="text-danger">*</span></label>
                          <div className="pos-input-wrap">
                            <span className="pos-input-prefix">₫</span>
                            <input
                              className="pos-input pos-input-money"
                              type="text"
                              placeholder="0"
                              value={formData.deposit_amount}
                              onChange={e => {
                                const raw = e.target.value.replace(/\D/g, '');
                                setFormData(p => ({ ...p, deposit_amount: raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '' }));
                              }}
                              autoFocus
                            />
                          </div>
                          <small className="text-muted">Tối đa: {formatCurrency(detail.total_amount - (detail.deposit_amount ?? 0))}</small>
                        </div>
                        <div className="order-subform-actions">
                          <button className="btn btn-secondary" onClick={() => setActiveForm(null)}>Huỷ</button>
                          <button className="btn btn-primary" onClick={handleFormSubmit} disabled={statusMut.isPending}>
                            {statusMut.isPending ? 'Đang lưu...' : '✓ Xác nhận'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sub-form: thu đủ tiền */}
                    {activeForm === 'payment' && (
                      <div className="order-subform">
                        <p className="order-subform-title">💳 Thu đủ tiền — phiếu thu</p>
                        <div className="form-grid">
                          <div className="form-group">
                            <label className="form-label">Số phiếu thu <span className="text-danger">*</span></label>
                            <input
                              className="form-control"
                              placeholder="PT-2026-XXXX"
                              value={formData.receipt_number}
                              onChange={e => setFormData(p => ({ ...p, receipt_number: e.target.value }))}
                              autoFocus
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">Ngày thu <span className="text-danger">*</span></label>
                            <input
                              className="form-control"
                              type="date"
                              max={new Date().toISOString().split('T')[0]}
                              value={formData.receipt_date}
                              onChange={e => setFormData(p => ({ ...p, receipt_date: e.target.value }))}
                            />
                          </div>
                          <div className="form-group" style={{ gridColumn: '1/-1' }}>
                            <label className="form-label">Ghi chú thanh toán</label>
                            <textarea
                              className="form-control"
                              rows={2}
                              placeholder="Ghi chú thêm (tuỳ chọn)"
                              value={formData.payment_note}
                              onChange={e => setFormData(p => ({ ...p, payment_note: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="order-subform-summary">
                          Tổng thu: <strong>{formatCurrency(detail.total_amount)}</strong>
                        </div>
                        <div className="order-subform-actions">
                          <button className="btn btn-secondary" onClick={() => setActiveForm(null)}>Huỷ</button>
                          <button className="btn btn-primary" onClick={handleFormSubmit} disabled={statusMut.isPending}>
                            {statusMut.isPending ? 'Đang lưu...' : '✓ Xác nhận thu tiền'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sub-form: PDI kỹ thuật */}
                    {activeForm === 'pdi' && (
                      <div className="order-subform">
                        <p className="order-subform-title">🔧 Xác nhận kiểm định PDI</p>
                        <div className="form-group">
                          <label className="form-label">Ghi chú kỹ thuật <span className="text-danger">*</span></label>
                          <textarea
                            className="form-control"
                            rows={4}
                            placeholder="Mô tả tình trạng xe sau kiểm tra: đèn, phanh, lốp, pin, khung sườn..."
                            value={formData.pdi_notes}
                            onChange={e => setFormData(p => ({ ...p, pdi_notes: e.target.value }))}
                            autoFocus
                          />
                          <small className="text-muted">{formData.pdi_notes.length}/1000 ký tự (tối thiểu 5)</small>
                        </div>
                        <div className="order-subform-actions">
                          <button className="btn btn-secondary" onClick={() => setActiveForm(null)}>Huỷ</button>
                          <button className="btn btn-primary" onClick={handleFormSubmit} disabled={statusMut.isPending}>
                            {statusMut.isPending ? 'Đang lưu...' : '✓ Xác nhận PDI xong'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sub-form: huỷ đơn */}
                    {activeForm === 'cancel' && (
                      <div className="order-subform order-subform-danger">
                        <p className="order-subform-title">❌ Huỷ đơn hàng #{detail.order_number}</p>
                        {['deposit_paid'].includes(detail.status) && (
                          <div className="order-subform-warning">
                            ⚠️ Đơn hàng đã đặt cọc {formatCurrency(detail.deposit_amount ?? 0)}. Sẽ tự động tạo phiếu hoàn tiền cọc khi huỷ.
                          </div>
                        )}
                        {['full_paid', 'invoice_requested', 'invoice_approved', 'pdi_pending', 'pdi_done'].includes(detail.status) && (
                          <div className="order-subform-warning">
                            ⚠️ Đơn hàng đã thu đủ tiền {formatCurrency(detail.total_amount ?? 0)}. Sẽ tự động tạo phiếu hoàn tiền khi huỷ.
                          </div>
                        )}
                        <div className="form-group">
                          <label className="form-label">Lý do huỷ <span className="text-danger">*</span></label>
                          <textarea
                            className="form-control"
                            rows={3}
                            placeholder="Nhập lý do huỷ đơn hàng..."
                            value={formData.cancel_reason}
                            onChange={e => setFormData(p => ({ ...p, cancel_reason: e.target.value }))}
                            autoFocus
                          />
                        </div>
                        {confirmCancel && (
                          <div className="order-subform-confirm">
                            Xác nhận huỷ đơn <strong>{detail.order_number}</strong>? Hành động này không thể hoàn tác.
                          </div>
                        )}
                        <div className="order-subform-actions">
                          <button className="btn btn-secondary" onClick={() => { setActiveForm(null); setConfirmCancel(false); }}>Đóng</button>
                          <button className="btn btn-danger" onClick={handleFormSubmit} disabled={statusMut.isPending}>
                            {statusMut.isPending ? 'Đang xử lý...' : confirmCancel ? '⚠️ Xác nhận huỷ đơn' : 'Tiếp tục'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Đơn hoàn tất */}
                {detail.status === 'delivered' && (
                  <div className="order-action-panel" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                    <div style={{ textAlign: 'center', color: '#15803d', fontSize: 15, fontWeight: 600 }}>
                      🎉 Đơn hàng đã hoàn tất — xe đã bàn giao thành công
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
