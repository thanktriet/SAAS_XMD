// ============================================================
// Màn hình thu tiền — /payment/:orderId
// Stack: Vite + React Router v7 + Supabase Realtime
// Mục tiêu: tiền về → hóa đơn xuất < 2 phút, không bước duyệt tay
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Receipt } from '../types/accounting';
import type { PaymentSettings } from '../types';
import { DEFAULT_PAYMENT_SETTINGS } from '../types';
import {
  buildSePayQRUrl,
  formatVND,
  formatVNDateTime,
} from '../types/accounting';

// ---- Confetti ----
function Confetti() {
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7'];
  return (
    <div
      aria-hidden
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 9999 }}
    >
      {Array.from({ length: 60 }).map((_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            display: 'block',
            width: 8,
            height: 8,
            borderRadius: 2,
            left: `${Math.random() * 100}%`,
            top: `-${Math.random() * 20 + 5}%`,
            backgroundColor: colors[i % colors.length],
            animation: `confettiFall ${Math.random() * 2 + 2}s ${Math.random() * 2}s ease-in forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ---- Types ----
type PaymentTab = 'qr' | 'cash' | 'debt';

interface OrderInfo {
  id: string;
  order_code: string;
  total_amount: number;
  status: string;
  customer_name: string;
  customer_phone: string;
  branch_id: string;
  vehicle_model: string;
  vehicle_color: string;
  already_paid: number;
}

// ---- Helpers UI ----
function Row({ label, value, bold = false, green = false }: {
  label: string; value: string; bold?: boolean; green?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ color: '#9ca3af', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 600 : 400, color: green ? '#16a34a' : '#1f2937' }}>
        {value}
      </span>
    </div>
  );
}

const STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  draft:        { label: 'Nháp',          bg: '#f3f4f6', color: '#4b5563' },
  confirmed:    { label: 'Đã xác nhận',   bg: '#dbeafe', color: '#1d4ed8' },
  deposit_paid: { label: 'Đặt cọc',       bg: '#fef9c3', color: '#92400e' },
  full_paid:    { label: 'Đã thanh toán', bg: '#dcfce7', color: '#15803d' },
  delivered:    { label: 'Đã giao xe',    bg: '#f3e8ff', color: '#7c3aed' },
};

// ============================================================
export default function PaymentPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  // ---- Cấu hình thanh toán từ DB (thay thế VITE_BANK_*) ----
  const { data: paySettings } = useQuery<PaymentSettings>({
    queryKey: ['payment-settings'],
    queryFn: () => api.get('/settings/payment').then(r => r.data),
    staleTime: 5 * 60 * 1000,   // cache 5 phút
    placeholderData: DEFAULT_PAYMENT_SETTINGS,
  });
  const ps = paySettings ?? DEFAULT_PAYMENT_SETTINGS;

  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PaymentTab>('qr');
  const [isPaid, setIsPaid] = useState(false);
  const [paidReceipt, setPaidReceipt] = useState<Receipt | null>(null);

  // Form tiền mặt
  const [cashAmount, setCashAmount] = useState('');
  const [cashNote, setCashNote] = useState('');
  const [cashSubmitting, setCashSubmitting] = useState(false);

  // Form công nợ
  const [debtNote, setDebtNote] = useState('');
  const [debtDueDate, setDebtDueDate] = useState('');
  const [debtSubmitting, setDebtSubmitting] = useState(false);

  // ---- Load đơn hàng ----
  useEffect(() => {
    if (!orderId) return;

    async function load() {
      try {
        // Gọi Express API (đã có auth middleware)
        const { data: order } = await api.get(`/sales/${orderId}`);
        // Tính đã thu qua Express API → query acc_vouchers type=receipt posted
        const { data: paymentStatus } = await api.get(`/accounting/orders/${orderId}/payment-status`);
        const alreadyPaid: number = paymentStatus?.already_paid ?? 0;

        // ⚠️ DB thực tế dùng order_number, không phải order_code
        setOrder({
          id:             order.id,
          order_code:     order.order_number ?? order.order_code ?? order.id.slice(0, 8),
          total_amount:   order.total_amount,
          status:         order.status,
          customer_name:  order.customer?.full_name ?? order.customer_name ?? '—',
          customer_phone: order.customer?.phone ?? order.customer_phone ?? '—',
          branch_id:      order.branch_id ?? '',
          vehicle_model:  order.vehicle?.vehicle_model ?? order.vehicle_model ?? '—',
          vehicle_color:  order.vehicle?.color ?? order.vehicle_color ?? '—',
          already_paid:   alreadyPaid,
        });

        setCashAmount(String(order.total_amount - alreadyPaid));

        if (['full_paid', 'invoice_requested', 'invoice_approved', 'pdi_pending', 'pdi_done', 'delivered'].includes(order.status)) {
          setIsPaid(true);
        }
      } catch (err) {
        toast.error('Không tải được đơn hàng');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [orderId]);

  // ---- Polling: kiểm tra thanh toán mỗi 5s thay vì Supabase Realtime ----
  useEffect(() => {
    if (!orderId || isPaid) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/finance/receipts`, { params: { order_id: orderId } });
        const receipts = res.data?.data || res.data || [];
        const posted = receipts.find((r: any) => r.status === 'posted' && r.voucher_type === 'receipt');
        if (posted) {
          setPaidReceipt({
            id:               posted.id,
            receipt_code:     posted.voucher_number || posted.receipt_code,
            order_id:         orderId,
            customer_id:      null,
            branch_id:        order?.branch_id ?? '',
            amount:           posted.total_debit || posted.amount,
            payment_method:   'bank_transfer',
            status:           'posted',
            note:             null,
            created_by:       null,
            created_at:       posted.created_at,
            updated_at:       posted.created_at,
          });
          setIsPaid(true);
          toast.success('💰 Đã nhận thanh toán!', { duration: 3000 });
          clearInterval(interval);
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    return () => { clearInterval(interval); };
  }, [orderId, order?.branch_id, isPaid]);

  // ---- Thu tiền mặt ----
  const handleCashPayment = useCallback(async () => {
    if (!order) return;
    const amount = parseInt(cashAmount.replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) {
      toast.error('Nhập số tiền hợp lệ');
      return;
    }
    setCashSubmitting(true);
    try {
      const { data } = await api.post('/accounting/receipts', {
        order_id:       order.id,
        branch_id:      order.branch_id,
        amount,
        payment_method: 'cash',
        match_type:     'manual',
        note:           cashNote || undefined,
      });
      setPaidReceipt(data);
      setIsPaid(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Lỗi tạo phiếu thu';
      toast.error(msg);
    } finally {
      setCashSubmitting(false);
    }
  }, [order, cashAmount, cashNote]);

  // ---- Ghi công nợ ----
  const handleDebtPayment = useCallback(async () => {
    if (!order) return;
    const remaining = order.total_amount - order.already_paid;
    setDebtSubmitting(true);
    try {
      const { data } = await api.post('/accounting/receipts', {
        order_id:       order.id,
        branch_id:      order.branch_id,
        amount:         remaining,
        payment_method: 'debt',
        match_type:     'manual',
        note:           `Công nợ${debtNote ? ': ' + debtNote : ''}`,
        debt_due_date:  debtDueDate || undefined,
      });
      setPaidReceipt(data);
      setIsPaid(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Lỗi ghi công nợ';
      toast.error(msg);
    } finally {
      setDebtSubmitting(false);
    }
  }, [order, debtNote, debtDueDate]);

  // ---- Render states ----
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, gap: 12 }}>
      <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <span style={{ color: '#9ca3af' }}>Đang tải đơn hàng...</span>
    </div>
  );

  if (!order) return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
      <p style={{ color: '#ef4444', marginBottom: 16 }}>Không tìm thấy đơn hàng</p>
      <button onClick={() => navigate(-1)} style={{ color: '#3b82f6', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>
        Quay lại
      </button>
    </div>
  );

  const remaining = order.total_amount - order.already_paid;
  const paidPercent = Math.min((order.already_paid / order.total_amount) * 100, 100);

  // ---- QR URL ----
  const qrUrl = buildSePayQRUrl({
    bank:           ps.bank_code,
    account_number: ps.bank_account,
    amount:         remaining,
    description:    order.order_code,
    template:       'compact2',
  });

  // ============================================================
  // Màn hình thành công
  // ============================================================
  if (isPaid && paidReceipt) {
    const methodLabel: Record<string, string> = {
      bank_transfer: 'Chuyển khoản', cash: 'Tiền mặt', debt: 'Công nợ',
    };
    return (
      <>
        <Confetti />
        <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 16px' }}>
          <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: 32, textAlign: 'center' }}>
            {/* Icon */}
            <div style={{ width: 72, height: 72, background: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 32 }}>
              ✅
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>Thanh toán thành công!</h2>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24 }}>
              {formatVNDateTime(paidReceipt.created_at)}
            </p>

            {/* Chi tiết phiếu */}
            <div style={{ background: '#f9fafb', borderRadius: 12, padding: '12px 16px', marginBottom: 24, textAlign: 'left' }}>
              <Row label="Số phiếu"   value={paidReceipt.receipt_code} bold />
              <Row label="Khách hàng" value={order.customer_name} />
              <Row label="Đơn hàng"   value={order.order_code} />
              <Row label="Xe"         value={`${order.vehicle_model} — ${order.vehicle_color}`} />
              <Row label="Số tiền"    value={formatVND(paidReceipt.amount)} bold green />
              <Row label="Hình thức"  value={methodLabel[paidReceipt.payment_method] ?? paidReceipt.payment_method} />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => window.print()}
                style={{ flex: 1, padding: '12px 0', border: '1.5px solid #d1d5db', borderRadius: 12, background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#374151', fontSize: 14 }}
              >
                🖨️ In hóa đơn
              </button>
              <button
                onClick={() => navigate(`/delivery/${order.id}`)}
                style={{ flex: 1, padding: '12px 0', background: '#2563eb', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 600, color: '#fff', fontSize: 14 }}
              >
                🏍️ Giao xe
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // Màn hình thu tiền chính
  // ============================================================
  const statusInfo = STATUS_LABEL[order.status] ?? STATUS_LABEL.confirmed;
  const tabStyle = (tab: PaymentTab): React.CSSProperties => ({
    flex: 1, padding: '12px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
    borderBottom: activeTab === tab ? '2.5px solid #2563eb' : '2.5px solid transparent',
    background: activeTab === tab ? '#eff6ff' : '#fff',
    color: activeTab === tab ? '#2563eb' : '#6b7280',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ maxWidth: 520, margin: '24px auto', padding: '0 16px' }}>
      {/* Card đơn hàng */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 8px rgba(0,0,0,0.06)', border: '1px solid #f3f4f6', padding: 20, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <p style={{ color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Đơn hàng</p>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>{order.order_code}</h2>
          </div>
          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: statusInfo.bg, color: statusInfo.color }}>
            {statusInfo.label}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13, color: '#4b5563', marginBottom: 16 }}>
          <div><span style={{ color: '#9ca3af' }}>Khách: </span>{order.customer_name}</div>
          <div><span style={{ color: '#9ca3af' }}>ĐT: </span>{order.customer_phone}</div>
          <div style={{ gridColumn: '1/-1' }}><span style={{ color: '#9ca3af' }}>Xe: </span>{order.vehicle_model} — {order.vehicle_color}</div>
        </div>

        {/* Thanh tiến độ */}
        <div style={{ background: '#f9fafb', borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: '#6b7280' }}>Đã thu</span>
            <span style={{ fontWeight: 500 }}>{formatVND(order.already_paid)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
            <span style={{ color: '#6b7280' }}>Còn lại</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#2563eb' }}>{formatVND(remaining)}</span>
          </div>
          <div style={{ background: '#e5e7eb', borderRadius: 4, height: 6 }}>
            <div style={{ width: `${paidPercent}%`, height: 6, background: '#3b82f6', borderRadius: 4, transition: 'width 0.4s' }} />
          </div>
          <p style={{ textAlign: 'right', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            Tổng: {formatVND(order.total_amount)}
          </p>
        </div>
      </div>

      {/* Card tabs */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 8px rgba(0,0,0,0.06)', border: '1px solid #f3f4f6', overflow: 'hidden' }}>
        {/* Tab headers */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6' }}>
          <button style={tabStyle('qr')}   onClick={() => setActiveTab('qr')}>📱 QR Chuyển khoản</button>
          <button style={tabStyle('cash')} onClick={() => setActiveTab('cash')}>💵 Tiền mặt</button>
          <button style={tabStyle('debt')} onClick={() => setActiveTab('debt')}>📋 Công nợ</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* ---- Tab QR ---- */}
          {activeTab === 'qr' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', margin: 0 }}>
                Khách quét mã QR để chuyển khoản. Hệ thống tự xác nhận khi nhận tiền.
              </p>

              {/* Chưa cấu hình ngân hàng */}
              {(!ps.bank_code || !ps.bank_account) ? (
                <div style={{ border: '2px dashed #fbbf24', borderRadius: 16, padding: 24, background: '#fffbeb', textAlign: 'center', width: 224 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>⚙️</div>
                  <p style={{ color: '#92400e', fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>Chưa cấu hình ngân hàng</p>
                  <p style={{ color: '#b45309', fontSize: 12, margin: 0 }}>
                    Vào <strong>Cấu hình → Thanh toán & SEPay</strong> để điền mã ngân hàng và số tài khoản.
                  </p>
                </div>
              ) : (
                <div style={{ border: '2px dashed #e5e7eb', borderRadius: 16, padding: 12, background: '#f9fafb' }}>
                  <img
                    src={qrUrl}
                    alt="QR thanh toán"
                    width={200}
                    height={200}
                    style={{ borderRadius: 10, display: 'block' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

                <div style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', lineHeight: 1.8 }}>
                  <div>Ngân hàng: <strong style={{ color: '#374151' }}>{ps.bank_name || 'Chưa cấu hình'}</strong></div>
                  <div>STK: <strong style={{ color: '#374151', fontFamily: 'monospace' }}>{ps.bank_account || '—'}</strong></div>
                  {ps.bank_account_name && (
                    <div>Chủ TK: <strong style={{ color: '#374151' }}>{ps.bank_account_name}</strong></div>
                  )}
                  <div>Nội dung: <strong style={{ color: '#2563eb' }}>{order.order_code}</strong></div>
                  <div>Số tiền: <strong style={{ color: '#16a34a', fontSize: 14 }}>{formatVND(remaining)}</strong></div>
                </div>

              {/* Realtime pulse */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af' }}>
                <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
                  <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22c55e', opacity: 0.7, animation: 'ping 1.2s ease-out infinite' }} />
                  <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                </span>
                <style>{`@keyframes ping { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(2.2); opacity: 0; } }`}</style>
                Đang chờ xác nhận thanh toán...
              </div>
            </div>
          )}

          {/* ---- Tab Tiền mặt ---- */}
          {activeTab === 'cash' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>Nhập số tiền khách đưa (VND).</p>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  Số tiền thu <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="number"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="Ví dụ: 35000000"
                  min={1}
                  style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 16, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={(e) => (e.target.style.borderColor = '#3b82f6')}
                  onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                />
                {cashAmount && Number(cashAmount) > 0 && (
                  <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>= {formatVND(Number(cashAmount))}</p>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Ghi chú</label>
                <input
                  type="text"
                  value={cashNote}
                  onChange={(e) => setCashNote(e.target.value)}
                  placeholder="Tuỳ chọn"
                  style={{ width: '100%', padding: '8px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <button
                onClick={handleCashPayment}
                disabled={cashSubmitting || !cashAmount || Number(cashAmount) <= 0}
                style={{ padding: '13px 0', background: cashSubmitting ? '#86efac' : '#16a34a', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 600, fontSize: 15, cursor: cashSubmitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.2s' }}
              >
                {cashSubmitting
                  ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Đang xử lý...</>
                  : '✅ Xác nhận thu tiền mặt'
                }
              </button>
            </div>
          )}

          {/* ---- Tab Công nợ ---- */}
          {activeTab === 'debt' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
                ⚠️ Ghi nhận công nợ: Khách sẽ thanh toán <strong>{formatVND(remaining)}</strong> sau.
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Ngày hết hạn thanh toán</label>
                <input
                  type="date"
                  value={debtDueDate}
                  onChange={(e) => setDebtDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  style={{ width: '100%', padding: '8px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Lý do / Ghi chú</label>
                <textarea
                  value={debtNote}
                  onChange={(e) => setDebtNote(e.target.value)}
                  rows={3}
                  placeholder="Nhập lý do ghi công nợ..."
                  style={{ width: '100%', padding: '8px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <button
                onClick={handleDebtPayment}
                disabled={debtSubmitting}
                style={{ padding: '13px 0', background: debtSubmitting ? '#fcd34d' : '#d97706', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 600, fontSize: 15, cursor: debtSubmitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {debtSubmitting
                  ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Đang xử lý...</>
                  : '📋 Ghi nhận công nợ'
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
