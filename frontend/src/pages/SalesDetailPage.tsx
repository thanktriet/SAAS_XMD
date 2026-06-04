// Trang chi tiết đơn hàng — /sales/:id
// Deep-link được, full-screen, không modal lồng nhau
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { PaymentSettings } from '../types';
import { DEFAULT_PAYMENT_SETTINGS } from '../types';
import {
  formatCurrency, formatDate,
  ORDER_STATUS, ORDER_STATUS_STEPS, PAYMENT_METHOD,
  getAllowedActions,
  type ActionDef,
} from '../utils/helpers';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import PaymentPanel from '../components/payment/PaymentPanel';
import AttachmentsPanel from '../components/AttachmentsPanel';

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

// ─── Màu chủ đạo ─────────────────────────────────────────────────────────────
const C = {
  accent:   '#2563eb',
  muted:    '#6b7280',
  green:    '#16a34a',
  red:      '#dc2626',
  pageBg:   '#f8fafc',
  cardBg:   '#fff',
  border:   '#f1f5f9',
  shadow:   '0 1px 4px rgba(0,0,0,0.06)',
};

// ─── Style card dùng chung ────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background:   C.cardBg,
  borderRadius: 12,
  boxShadow:    C.shadow,
  border:       `1px solid ${C.border}`,
  padding:      20,
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize:     13,
  fontWeight:   600,
  color:        C.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 12,
  marginTop:    0,
};

// ─── Thanh tiến trình trạng thái ─────────────────────────────────────────────
function StatusProgressBar({ currentStatus }: { currentStatus: string }) {
  const isCancelled = currentStatus === 'cancelled';
  // Bỏ invoice_approved (bước trung gian) và deposit_paid (đã hiển thị ở phần thanh toán)
  const DISPLAY_STEPS = ORDER_STATUS_STEPS.filter(s => s !== 'invoice_approved' && s !== 'deposit_paid');
  const displayStatus = currentStatus === 'invoice_approved' ? 'invoice_requested'
                      : currentStatus === 'deposit_paid'     ? 'confirmed'
                      : currentStatus;
  const currentIdx   = DISPLAY_STEPS.indexOf(displayStatus as typeof DISPLAY_STEPS[number]);

  if (isCancelled) {
    return (
      <div style={{
        ...cardStyle,
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#fef2f2', border: '1px solid #fecaca',
      }}>
        <span style={{ fontSize: 20 }}>❌</span>
        <span style={{ fontWeight: 600, color: C.red }}>Đơn hàng đã huỷ</span>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, overflowX: 'auto' }}>
      <div style={{
        display:       'flex',
        alignItems:    'flex-start',
        gap:           0,
        overflowX:     'auto',
        minWidth:      0,
      }}>
        {DISPLAY_STEPS.map((step, idx) => {
          const isDone   = idx < currentIdx;
          const isActive = displayStatus === step;

          const dotBg    = isDone ? C.green : isActive ? C.accent : '#e5e7eb';
          const dotColor = (isDone || isActive) ? '#fff' : C.muted;
          const labelColor = isActive ? C.accent : isDone ? C.green : C.muted;

          return (
            <div key={step} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
              {/* Đường nối */}
              {idx < DISPLAY_STEPS.length - 1 && (
                <div style={{
                  position: 'absolute',
                  top: 13,
                  left: '50%',
                  width: '100%',
                  height: 2,
                  background: isDone ? C.green : '#e5e7eb',
                  zIndex: 0,
                }} />
              )}
              {/* Chấm */}
              <div style={{
                width: 28, height: 28,
                borderRadius: '50%',
                background: dotBg,
                color: dotColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                position: 'relative', zIndex: 1,
                border: isActive ? `2.5px solid ${C.accent}` : '2.5px solid transparent',
                flexShrink: 0,
              }}>
                {isDone ? '✓' : idx + 1}
              </div>
              {/* Label */}
              <div style={{
                fontSize: 11, marginTop: 5, textAlign: 'center',
                color: labelColor,
                fontWeight: isActive ? 600 : 400,
                lineHeight: 1.3,
                maxWidth: 72,
                wordBreak: 'keep-all',
              }}>
                {ORDER_STATUS[step]?.label ?? step}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Row thông tin 2 cột ──────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 13, color: C.muted, flexShrink: 0, marginRight: 12 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', color: '#1f2937' }}>{value || '—'}</span>
    </div>
  );
}

// ─── Row riêng cho mã DMS — admin/manager/accountant chỉnh inline ──────────
function DmsCodeRow({
  orderId, currentValue, canEdit, onUpdated,
}: {
  orderId: string;
  currentValue?: string | null;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  return (
    <EditableRow
      label="Mã DMS"
      currentValue={currentValue}
      canEdit={canEdit}
      placeholder="Nhập mã DMS"
      saveFn={async (v) => api.patch(`/sales/${orderId}/dms-code`, { dms_order_number: v })}
      successMsg="Đã cập nhật mã DMS"
      onUpdated={onUpdated}
    />
  );
}

// ─── Row số hợp đồng trả góp — admin/manager/accountant chỉnh inline ──────
function InstallmentContractRow({
  orderId, currentValue, canEdit, onUpdated,
}: {
  orderId: string;
  currentValue?: string | null;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  return (
    <EditableRow
      label="Số hợp đồng trả góp"
      currentValue={currentValue}
      canEdit={canEdit}
      placeholder="VD: HĐ-FE-2026/00123"
      saveFn={async (v) => api.patch(`/sales/${orderId}/installment-contract`, { installment_contract_number: v })}
      successMsg="Đã cập nhật số hợp đồng"
      onUpdated={onUpdated}
    />
  );
}

// ─── Row inline-edit dùng chung cho mã DMS / số hợp đồng trả góp ──────────
function EditableRow({
  label, currentValue, canEdit, placeholder, saveFn, successMsg, onUpdated,
}: {
  label: string;
  currentValue?: string | null;
  canEdit: boolean;
  placeholder: string;
  saveFn: (value: string | null) => Promise<unknown>;
  successMsg: string;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await saveFn(value.trim() || null);
      toast.success(successMsg);
      setEditing(false);
      onUpdated();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Lỗi cập nhật');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 13, color: C.muted, flexShrink: 0, marginRight: 12 }}>{label}</span>
      {editing ? (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            style={{
              fontFamily: 'monospace', fontSize: 12, padding: '4px 8px',
              border: '1px solid #d1d5db', borderRadius: 4, width: 200,
            }}
          />
          <button onClick={save} disabled={saving}
            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            {saving ? '...' : '✓'}
          </button>
          <button onClick={() => { setEditing(false); setValue(currentValue ?? ''); }}
            style={{ padding: '4px 10px', fontSize: 12, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
            ✕
          </button>
        </span>
      ) : (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {currentValue
            ? <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: '#0369a1' }}>{currentValue}</span>
            : <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>Chưa nhập</span>
          }
          {canEdit && (
            <button onClick={() => { setValue(currentValue ?? ''); setEditing(true); }}
              style={{
                padding: '2px 8px', fontSize: 11, fontWeight: 600,
                background: '#eff6ff', color: '#1d4ed8',
                border: '1px solid #bfdbfe', borderRadius: 4, cursor: 'pointer',
              }}>
              ✏️ {currentValue ? 'Sửa' : 'Nhập'}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// ─── Skeleton loading ─────────────────────────────────────────────────────────
function Skeleton() {
  const bar = (w: string | number, h = 16, mb = 8) => (
    <div style={{ width: w, height: h, background: '#e5e7eb', borderRadius: 6, marginBottom: mb, animation: 'pulse 1.5s ease-in-out infinite' }} />
  );
  return (
    <>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
      <div style={{ ...cardStyle }}>{bar('40%', 20, 12)}{bar('80%')}{bar('60%')}{bar('70%')}</div>
      <div style={{ ...cardStyle }}>{bar('30%', 18, 12)}{bar('90%')}{bar('75%')}</div>
      <div style={{ ...cardStyle }}>{bar('50%', 18, 12)}{bar('100%')}{bar('80%')}{bar('60%')}</div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function SalesDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const { user }  = useAuthStore();
  const userRole  = user?.role ?? '';

  // State form — chỉ còn PDI và huỷ đơn
  const [activeForm,     setActiveForm]     = useState<'pdi' | 'cancel' | null>(null);
  const [formData,       setFormData]       = useState<FormData>(EMPTY_FORM);
  const [confirmCancel,  setConfirmCancel]  = useState(false);

  // ── Query đơn hàng ────────────────────────────────────────────────────────
  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['sales-detail', id],
    queryFn:  () => api.get(`/sales/${id}`).then(r => r.data),
    enabled:  !!id,
    retry:    1,
  });

  // ── Query cấu hình thanh toán (cho QR) ───────────────────────────────────
  const { data: paySettings } = useQuery<PaymentSettings>({
    queryKey:         ['payment-settings'],
    queryFn:          () => api.get('/settings/payment').then(r => r.data),
    staleTime:        300_000,
    placeholderData:  DEFAULT_PAYMENT_SETTINGS,
  });
  const ps = paySettings ?? DEFAULT_PAYMENT_SETTINGS;

  // ── Mutation đổi trạng thái ───────────────────────────────────────────────
  const statusMut = useMutation({
    mutationFn: ({ toStatus, extra }: { toStatus: string; extra?: Record<string, unknown> }) =>
      api.patch(`/sales/${id}/status`, { status: toStatus, ...extra }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales-detail', id] });
      setActiveForm(null);
      setFormData(EMPTY_FORM);
      setConfirmCancel(false);
      toast.success(`Đã chuyển: ${ORDER_STATUS[data.order?.status]?.label ?? data.order?.status}`);
    },
    onError: (e: unknown) => {
      // e có thể là AxiosError — dùng type assertion an toàn
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Lỗi cập nhật trạng thái';
      toast.error(msg);
    },
  });

  // ── Các hành động cho role hiện tại ──────────────────────────────────────
  const allowedActions: ActionDef[] = detail
    ? getAllowedActions(detail.status, userRole)
    : [];

  // ── Xử lý khi bấm nút action (chỉ còn PDI, huỷ, giao xe) ──────────────────
  function handleAction(action: ActionDef) {
    if (action.toStatus === 'draft' && detail?.status !== 'draft') {
      // Reopen — confirm trước
      const ok = confirm(
        `Mở lại đơn ${detail?.order_number}?\n\n` +
        `Đơn sẽ chuyển về trạng thái "Mở" để chỉnh sửa lại.\n` +
        `✓ Lịch sử thanh toán + tiền cọc được GIỮ NGUYÊN\n` +
        `✓ Xe trong đơn (đã sold) sẽ chuyển về "reserved"\n\n` +
        `Tiếp tục?`
      );
      if (!ok) return;
      statusMut.mutate({ toStatus: 'draft' });
      return;
    }
    if (!action.formType) {
      statusMut.mutate({ toStatus: action.toStatus });
      return;
    }
    setActiveForm(action.formType as 'pdi' | 'cancel');
    setConfirmCancel(false);
  }

  // ── Submit form inline ────────────────────────────────────────────────────
  function handleFormSubmit() {
    if (!activeForm) return;
    let extra: Record<string, unknown> = {};

    switch (activeForm) {
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

  // ── Style nút theo variant ────────────────────────────────────────────────
  function btnStyle(variant: ActionDef['variant']): React.CSSProperties {
    const base: React.CSSProperties = {
      padding: '8px 16px', borderRadius: 8, border: 'none',
      cursor: 'pointer', fontWeight: 600, fontSize: 13,
    };
    if (variant === 'danger')   return { ...base, background: '#dc2626', color: '#fff' };
    if (variant === 'warning')  return { ...base, background: '#d97706', color: '#fff' };
    return { ...base, background: C.accent, color: '#fff' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Render: Loading
  // ══════════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div style={{ background: C.pageBg, minHeight: '100vh' }}>
        {/* Topbar skeleton */}
        <div style={{ background: '#fff', borderBottom: `1px solid ${C.border}`, padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 180, height: 20, background: '#e5e7eb', borderRadius: 6 }} />
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px', display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          <Skeleton />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Render: Lỗi / không tìm thấy
  // ══════════════════════════════════════════════════════════════════════════
  if (isError || !detail) {
    return (
      <div style={{ background: C.pageBg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
          <p style={{ color: C.red, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Không tìm thấy đơn hàng
          </p>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>
            Đơn hàng không tồn tại hoặc bạn không có quyền xem.
          </p>
          <button
            onClick={() => navigate('/sales')}
            style={{ ...btnStyle('primary') }}
          >
            ← Quay lại danh sách
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Render: Trang chi tiết
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ background: C.pageBg, minHeight: '100vh' }}>

      {/* ── TOPBAR ─────────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff',
        borderBottom: `1px solid ${C.border}`,
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <Link
            to="/sales"
            style={{ color: C.accent, textDecoration: 'none', fontWeight: 500 }}
          >
            ← Đơn hàng
          </Link>
          <span style={{ color: C.muted }}>/</span>
          <span style={{ fontWeight: 700, color: '#1f2937' }}>{detail.order_number}</span>
          <span style={{ marginLeft: 8 }}>
            <span className={`badge ${ORDER_STATUS[detail.status]?.cls || 'badge-gray'}`}>
              {ORDER_STATUS[detail.status]?.label || detail.status}
            </span>
          </span>
        </div>

        {/* Nút topbar */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => {
              // Ghi toàn bộ detail vào sessionStorage rồi mở tab in
              sessionStorage.setItem('print_order', JSON.stringify(detail));
              window.open('/print-order.html', '_blank');
            }}
            style={{
              padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: '#fff',
              cursor: 'pointer', fontWeight: 500, fontSize: 13, color: '#374151',
            }}
          >
            🖨️ In đơn
          </button>
        </div>
      </div>

      {/* ── NỘI DUNG 2 CỘT ─────────────────────────────────────────────── */}
      <div className="sales-detail-grid" style={{
        maxWidth: 1200,
        margin:   '0 auto',
        padding:  '20px 24px',
        display:  'grid',
        gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
        gap: 20,
        alignItems: 'start',
      }}>

        {/* ════════════════════════════════════════════════════════════════
            CỘT TRÁI
        ════════════════════════════════════════════════════════════════ */}
        <div>

          {/* Thanh tiến trình */}
          <StatusProgressBar currentStatus={detail.status} />

          {/* ── Card: Thông tin đơn hàng ─────────────────────────────── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>🏍️ Thông tin đơn hàng</p>
            <InfoRow label="Mã đơn hàng"           value={<span style={{ fontFamily: 'monospace', color: C.accent, fontWeight: 700 }}>{detail.order_number}</span>} />
            <InfoRow label="Ngày đặt hàng"          value={formatDate(detail.order_date)} />
            <InfoRow label="Ngày giao xe dự kiến"   value={detail.delivery_date ? formatDate(detail.delivery_date) : undefined} />
            <InfoRow label="Phương thức thanh toán" value={PAYMENT_METHOD[detail.payment_method] || detail.payment_method} />
            <InfoRow label="Nhân viên bán hàng"     value={detail.users?.full_name} />
            <DmsCodeRow
              orderId={detail.id}
              currentValue={detail.dms_order_number}
              canEdit={['admin', 'manager', 'accountant'].includes(userRole)}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['sales-detail', detail.id] })}
            />
            {detail.payment_method === 'installment' && (
              <InstallmentContractRow
                orderId={detail.id}
                currentValue={detail.installment_contract_number}
                canEdit={['admin', 'manager', 'accountant'].includes(userRole)}
                onUpdated={() => qc.invalidateQueries({ queryKey: ['sales-detail', detail.id] })}
              />
            )}
          </div>

          {/* ── Card: Khách hàng ─────────────────────────────────────── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>👤 Khách hàng</p>
            <InfoRow label="Họ và tên"     value={<span style={{ fontWeight: 600 }}>{detail.customers?.full_name}</span>} />
            <InfoRow label="Số điện thoại" value={detail.customers?.phone} />
            <InfoRow label="Email"         value={detail.customers?.email} />
            {detail.delivery_address && (
              <InfoRow label="Địa chỉ giao xe" value={`📍 ${detail.delivery_address}`} />
            )}
          </div>

          {/* ── Card: Xe trong đơn ───────────────────────────────────── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>🛵 Xe trong đơn</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Mẫu xe', 'Màu', 'VIN', 'SL', 'Đơn giá', 'Giảm', 'Thành tiền'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: h === 'SL' ? 'center' : ['Đơn giá','Giảm','Thành tiền'].includes(h) ? 'right' : 'left', fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail.sales_order_items ?? []).length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: C.muted, padding: 16 }}>Không có dữ liệu</td></tr>
                  ) : detail.sales_order_items.map((item: {
                    id: string; vehicle_models?: { brand?: string; model_name?: string };
                    inventory_vehicles?: { color?: string; vin?: string };
                    quantity: number; unit_price: number; discount_percent: number | string; line_total: number | string;
                  }, idx: number) => {
                    const isFirst = idx === 0;
                    const orderKM = Number(detail.discount_amount ?? 0);
                    const itemPct = Number(item.discount_percent ?? 0);
                    const itemLineTotal = Number(item.line_total ?? 0);
                    const showOrderKM = isFirst && orderKM > 0 && !(itemPct > 0);
                    const sauKM = Math.max(0, itemLineTotal - (showOrderKM ? orderKM : 0));
                    return (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                        {item.vehicle_models?.brand} {item.vehicle_models?.model_name}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{item.inventory_vehicles?.color || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.inventory_vehicles?.vin || '—'}</span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{formatCurrency(item.unit_price)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>
                        {itemPct > 0
                          ? `${itemPct}%`
                          : (showOrderKM
                              ? `-${formatCurrency(orderKM)}`
                              : '—')}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                        {showOrderKM ? (
                          <>
                            <div style={{ textDecoration: 'line-through', color: C.muted, fontWeight: 400, fontSize: 12 }}>
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
          </div>

          {/* ── Card: Phụ kiện (ẩn nếu rỗng) ────────────────────────── */}
          {(detail.sales_order_accessories ?? []).length > 0 && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>🎒 Phụ kiện đi kèm</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Phụ kiện', 'Mã', 'SL', 'Đơn giá', 'Thành tiền'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === 'SL' ? 'center' : ['Đơn giá','Thành tiền'].includes(h) ? 'right' : 'left', fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sales_order_accessories.map((acc: {
                      id: string; accessories?: { name?: string; code?: string; category?: string };
                      quantity: number; unit_price: number; line_total: number;
                      serial_numbers?: string[] | null;
                      assignment_type?: 'purchase' | 'rent' | null;
                    }) => {
                      const isBattery = acc.accessories?.category === 'battery';
                      const isRent    = isBattery && acc.assignment_type === 'rent';
                      const serials   = Array.isArray(acc.serial_numbers) ? acc.serial_numbers.filter(Boolean) : [];
                      return (
                      <tr key={acc.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                          {isBattery && '🔋 '}{acc.accessories?.name || '—'}
                          {isBattery && (
                            <span style={{
                              marginLeft: 6, padding: '1px 8px', borderRadius: 99,
                              fontSize: 10, fontWeight: 600,
                              background: isRent ? '#f5f3ff' : '#f0fdf4',
                              color:      isRent ? '#6d28d9' : '#15803d',
                            }}>
                              {isRent ? 'Pin thuê' : 'Mua đứt'}
                            </span>
                          )}
                          {serials.length > 0 && (
                            <div style={{
                              fontSize: 11, fontFamily: 'monospace',
                              color: '#0369a1', marginTop: 4,
                              wordBreak: 'break-all', lineHeight: 1.5,
                            }}>
                              Serial: {serials.join(', ')}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontFamily: 'monospace', color: C.muted, fontSize: 11 }}>{acc.accessories?.code || '—'}</span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>{acc.quantity}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {isRent ? <span style={{ color: '#9ca3af' }}>—</span> : formatCurrency(acc.unit_price)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                          {isRent ? '0 ₫' : formatCurrency(acc.line_total)}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Card: Khuyến mãi (ẩn nếu rỗng) ──────────────────────── */}
          {(detail.sales_order_promotions ?? []).length > 0 && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>🎁 Chương trình khuyến mãi</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Tên chương trình', 'Loại', 'Ưu đãi'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Ưu đãi' ? 'right' : 'left', fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sales_order_promotions.map((p: {
                      id: string; promo_name: string; promo_type: string;
                      discount_amount: number; gift_item_name?: string; gift_quantity?: number;
                    }) => (
                      <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{p.promo_name}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 999, fontSize: 11,
                            background: p.promo_type === 'percent' ? '#dbeafe' : p.promo_type === 'fixed' ? '#dcfce7' : '#ede9fe',
                            color:      p.promo_type === 'percent' ? '#1d4ed8' : p.promo_type === 'fixed' ? '#15803d' : '#6d28d9',
                          }}>
                            {p.promo_type === 'percent' ? 'Giảm %' : p.promo_type === 'fixed' ? 'Giảm tiền' : p.promo_type === 'gift' ? 'Quà tặng' : 'Combo'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {(p.promo_type === 'gift' || p.promo_type === 'combo')
                            ? <span style={{ color: '#6d28d9' }}>🎁 {p.gift_item_name} ×{p.gift_quantity}</span>
                            : <span style={{ color: C.red, fontWeight: 600 }}>-{formatCurrency(p.discount_amount)}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Card: Phí & Dịch vụ (ẩn nếu rỗng) ───────────────────── */}
          {((detail.sales_order_fees ?? []).length > 0 || (detail.sales_order_services ?? []).length > 0) && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>📋 Phí &amp; Dịch vụ đăng ký</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Nội dung', 'Loại', 'Số tiền'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Số tiền' ? 'right' : 'left', fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.sales_order_fees ?? []).map((f: { id: string; fee_label: string; amount: number }) => (
                      <tr key={f.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{f.fee_label}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>Phí</span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(f.amount)}</td>
                      </tr>
                    ))}
                    {(detail.sales_order_services ?? []).map((s: { id: string; service_name: string; price: number }) => (
                      <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{s.service_name}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>Dịch vụ</span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(s.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Card: Ghi chú (ẩn nếu rỗng) ─────────────────────────── */}
          {detail.notes && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>📝 Ghi chú đơn hàng</p>
              <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{detail.notes}</p>
            </div>
          )}

          {/* ── Card: Hồ sơ đính kèm ────────────────────────────────── */}
          <AttachmentsPanel
            orderId={id!}
            readOnly={detail.status === 'cancelled' || detail.status === 'delivered'}
          />

          {/* ── Card: PDI (ẩn nếu chưa có) ───────────────────────────── */}
          {detail.pdi_notes && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>🔧 Kết quả kiểm định PDI</p>
              {detail.technician && (
                <InfoRow label="Kỹ thuật viên" value={`🔧 ${detail.technician?.full_name}`} />
              )}
              <div style={{ marginTop: 8, background: '#f0fdf4', border: `1px solid #bbf7d0`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15803d', lineHeight: 1.6 }}>
                {detail.pdi_notes}
              </div>
            </div>
          )}

          {/* ── Card: Thông tin phiếu thu (nếu đã thu tiền) ──────────── */}
          {detail.receipt_number && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>🧾 Thông tin phiếu thu</p>
              <InfoRow label="Số phiếu thu"  value={<span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{detail.receipt_number}</span>} />
              <InfoRow label="Ngày thu tiền" value={formatDate(detail.receipt_date)} />
              {detail.payment_note && (
                <InfoRow label="Ghi chú thanh toán" value={detail.payment_note} />
              )}
              {detail.approved_by_user && (
                <InfoRow label="Người duyệt hoá đơn" value={`✅ ${detail.approved_by_user?.full_name}`} />
              )}
            </div>
          )}

          {/* ── Card: Lý do huỷ (ẩn nếu không phải cancelled) ────────── */}
          {detail.status === 'cancelled' && detail.cancel_reason && (
            <div style={{ ...cardStyle, background: '#fef2f2', border: `1px solid #fecaca` }}>
              <p style={{ ...sectionTitleStyle, color: C.red }}>❌ Lý do huỷ đơn</p>
              <p style={{ margin: 0, fontSize: 14, color: '#7f1d1d', lineHeight: 1.6 }}>{detail.cancel_reason}</p>
            </div>
          )}

          {/* ── Đơn hoàn tất ────────────────────────────────────────── */}
          {detail.status === 'delivered' && (
            <div style={{ ...cardStyle, background: '#f0fdf4', border: `1px solid #bbf7d0`, textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
              <p style={{ margin: 0, fontWeight: 700, color: '#15803d', fontSize: 15 }}>
                Đơn hàng đã hoàn tất — xe đã bàn giao thành công
              </p>
            </div>
          )}

        </div>

        {/* ════════════════════════════════════════════════════════════════
            CỘT PHẢI
        ════════════════════════════════════════════════════════════════ */}
        <div>

          {/* ── Card: Thanh toán (PaymentPanel) ─────────────────────────── */}
          <PaymentPanel
            orderId={id!}
            order={{
              order_number:    detail.order_number,
              total_amount:    detail.total_amount,
              status:          detail.status,
              subtotal:        detail.subtotal,
              discount_amount: detail.discount_amount,
              tax_amount:      detail.tax_amount,
            }}
            paymentSettings={ps}
          />

          {/* ── Card: Hành động đơn hàng (PDI, giao xe, huỷ) ────────────── */}
          {allowedActions.length > 0 && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>⚙️ Hành động</p>

              {detail.status === 'draft' && !activeForm && (
                <button
                  onClick={() => navigate(`/sales/new?edit=${detail.id}`)}
                  style={{
                    ...btnStyle('primary'),
                    width: '100%', padding: '10px 16px', textAlign: 'center',
                    marginBottom: 8,
                    background: '#f59e0b', borderColor: '#f59e0b',
                  }}
                >
                  ✏️ Mở đơn để sửa (gán VIN, chỉnh KM, phụ kiện...)
                </button>
              )}

              {!activeForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allowedActions
                    .filter(a => !['deposit_paid', 'full_paid'].includes(a.toStatus))
                    .map(action => (
                      <button
                        key={action.toStatus}
                        onClick={() => handleAction(action)}
                        disabled={statusMut.isPending}
                        style={{ ...btnStyle(action.variant), width: '100%', padding: '10px 16px', textAlign: 'center' }}
                      >
                        {action.label}
                      </button>
                    ))}
                </div>
              )}

              {/* Sub-form: PDI */}
              {activeForm === 'pdi' && (
                <div style={{ background: '#f5f3ff', borderRadius: 10, padding: 16, border: `1px solid #ddd6fe` }}>
                  <p style={{ ...sectionTitleStyle, color: '#7c3aed' }}>🔧 Xác nhận kiểm định PDI</p>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                      Ghi chú kỹ thuật <span style={{ color: C.red }}>*</span>
                    </label>
                    <textarea
                      rows={4}
                      autoFocus
                      placeholder="Mô tả tình trạng xe sau kiểm tra: đèn, phanh, lốp, pin, khung sườn..."
                      value={formData.pdi_notes}
                      onChange={e => setFormData(p => ({ ...p, pdi_notes: e.target.value }))}
                      style={{ width: '100%', padding: '8px 12px', border: `1.5px solid #c4b5fd`, borderRadius: 8, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                    <small style={{ color: C.muted, fontSize: 11 }}>{formData.pdi_notes.length}/1000 ký tự (tối thiểu 5)</small>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setActiveForm(null)} style={{ flex: 1, padding: '9px 0', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>Huỷ</button>
                    <button onClick={handleFormSubmit} disabled={statusMut.isPending} style={{ flex: 2, ...btnStyle('primary'), padding: '9px 0' }}>
                      {statusMut.isPending ? 'Đang lưu...' : '✓ PDI hoàn tất'}
                    </button>
                  </div>
                </div>
              )}

              {/* Sub-form: huỷ đơn */}
              {activeForm === 'cancel' && (
                <div style={{ background: '#fef2f2', borderRadius: 10, padding: 16, border: `1px solid #fecaca` }}>
                  <p style={{ ...sectionTitleStyle, color: C.red }}>❌ Huỷ đơn #{detail.order_number}</p>
                  {['deposit_paid', 'full_paid', 'invoice_requested', 'invoice_approved', 'pdi_pending', 'pdi_done'].includes(detail.status) && (
                    <div style={{ background: '#fef3c7', border: `1px solid #fde68a`, borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#92400e' }}>
                      ⚠️ Đơn đã có thanh toán — kế toán sẽ cần xử lý hoàn tiền thủ công.
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                      Lý do huỷ <span style={{ color: C.red }}>*</span>
                    </label>
                    <textarea
                      rows={3}
                      autoFocus
                      placeholder="Nhập lý do huỷ đơn hàng..."
                      value={formData.cancel_reason}
                      onChange={e => setFormData(p => ({ ...p, cancel_reason: e.target.value }))}
                      style={{ width: '100%', padding: '8px 12px', border: `1.5px solid #fca5a5`, borderRadius: 8, fontSize: 13, outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  {confirmCancel && (
                    <div style={{ background: '#fee2e2', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, color: '#991b1b', fontWeight: 500, textAlign: 'center' }}>
                      Xác nhận huỷ <strong>{detail.order_number}</strong>? Không thể hoàn tác.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setActiveForm(null); setConfirmCancel(false); }} style={{ flex: 1, padding: '9px 0', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>Đóng</button>
                    <button onClick={handleFormSubmit} disabled={statusMut.isPending} style={{ flex: 2, ...btnStyle('danger'), padding: '9px 0' }}>
                      {statusMut.isPending ? 'Đang xử lý...' : confirmCancel ? '⚠️ Xác nhận huỷ' : 'Tiếp tục'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}


          {/* ── Card: Lịch sử / Timeline ──────────────────────────────── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>📋 Lịch sử đơn hàng</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Helper render 1 mốc */}
              {([
                {
                  icon: '📅',
                  label: 'Ngày đặt hàng',
                  value: detail.order_date,
                  show: true,
                },
                {
                  icon: '💰',
                  label: 'Đặt cọc',
                  value: detail.deposit_amount > 0 ? detail.updated_at : null,
                  extra: detail.deposit_amount > 0 ? formatCurrency(detail.deposit_amount) : null,
                  show: (detail.deposit_amount ?? 0) > 0,
                },
                {
                  icon: '💳',
                  label: 'Thu đủ tiền',
                  value: detail.receipt_date,
                  extra: detail.receipt_number ? `Phiếu ${detail.receipt_number}` : null,
                  show: !!detail.receipt_date,
                },
                {
                  icon: '🚗',
                  label: 'Giao xe dự kiến',
                  value: detail.delivery_date,
                  show: !!detail.delivery_date,
                },
                {
                  icon: '🔧',
                  label: 'Kiểm định PDI',
                  value: detail.pdi_notes ? detail.updated_at : null,
                  extra: detail.pdi_notes ? 'Hoàn tất PDI' : null,
                  show: !!detail.pdi_notes,
                },
              ] as Array<{
                icon: string; label: string;
                value?: string | null; extra?: string | null; show: boolean;
              }>).filter(m => m.show).map((milestone, idx, arr) => (
                <div key={idx} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: idx < arr.length - 1 ? 16 : 0 }}>
                  {/* Đường dọc */}
                  {idx < arr.length - 1 && (
                    <div style={{ position: 'absolute', left: 15, top: 28, width: 2, bottom: 0, background: '#e5e7eb' }} />
                  )}
                  {/* Icon */}
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, zIndex: 1 }}>
                    {milestone.icon}
                  </div>
                  {/* Nội dung */}
                  <div style={{ paddingTop: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{milestone.label}</div>
                    {milestone.value && (
                      <div style={{ fontSize: 12, color: C.muted }}>{formatDate(milestone.value)}</div>
                    )}
                    {milestone.extra && (
                      <div style={{ fontSize: 12, color: C.accent }}>{milestone.extra}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>{/* /cột phải */}
      </div>{/* /grid */}
    </div>
  );
}
