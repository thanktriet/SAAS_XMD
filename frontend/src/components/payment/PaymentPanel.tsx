// components/payment/PaymentPanel.tsx
// Component thanh toán đơn hàng — thay thế toàn bộ logic deposit/payment cũ trong SalesDetailPage

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { buildSePayQRUrl } from '../../types/accounting';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

// ─── Kiểu dữ liệu ───────────────────────────────────────────────────────────

interface OrderPayment {
  id: string;
  payment_method: 'cash' | 'bank_transfer' | 'qr_code';
  amount: number;
  payment_date: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  receipt_number?: string;
  bank_reference?: string;
  transfer_screenshot_url?: string;
  sepay_transaction_id?: string;
  finance_transaction_id?: string;   // có → đã ghi finance_transactions
  notes?: string;
  created_at: string;
  confirmed_at?: string;
  created_by_user?: { id: string; full_name: string };
  confirmed_by_user?: { id: string; full_name: string };
}

interface PaymentSummary {
  total_amount: number;
  total_paid: number;
  total_pending: number;
  remaining: number;
}

interface PaymentPanelProps {
  orderId: string;
  order: {
    order_number:    string;
    total_amount:    number;
    status:          string;
    subtotal?:       number;
    discount_amount?: number;
    tax_amount?:     number;
  };
  paymentSettings?: {
    bank_code?:         string;
    bank_account?:      string;
    bank_name?:         string;
    bank_account_name?: string;
  };
}

// Kiểu tab form thêm thanh toán — bỏ 'qr' vì CK đã tích hợp QR
type AddTab = 'bank_transfer' | 'cash';

// Kiểu dữ liệu form chuyển khoản / tiền mặt
interface PaymentFormState {
  amount: string;
  payment_date: string;
  notes: string;
  transfer_screenshot_url: string;
}

// Kiểu dữ liệu form xác nhận (kế toán/manager/admin)
interface ConfirmFormState {
  receipt_number: string;
  bank_reference: string;
  notes: string;
}

// ─── Hằng số màu sắc ────────────────────────────────────────────────────────

const C = {
  accent:  '#2563eb',
  green:   '#16a34a',
  yellow:  '#d97706',
  red:     '#dc2626',
  muted:   '#6b7280',
  border:  '#e5e7eb',
  bg:      '#f8fafc',
};

// ─── Helper: lấy nhãn & icon phương thức thanh toán ─────────────────────────

function getMethodLabel(method: OrderPayment['payment_method']): string {
  switch (method) {
    case 'cash':          return '💵 Tiền mặt';
    case 'bank_transfer': return '🏦 Chuyển khoản';
    case 'qr_code':       return '📱 QR SEPay';
    default:              return method;
  }
}

// ─── Helper: kiểm tra role có quyền xác nhận/huỷ ───────────────────────────

function canConfirm(role: string | undefined): boolean {
  return role === 'accountant' || role === 'manager' || role === 'admin';
}

// ─── Ngày hôm nay định dạng YYYY-MM-DD (cho default date input) ─────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════════════════════
// Component chính
// ════════════════════════════════════════════════════════════════════════════

export default function PaymentPanel({ orderId, order, paymentSettings }: PaymentPanelProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;

  // Đơn đã hoàn thành thanh toán, huỷ, hoặc đã qua giai đoạn thanh toán → ẩn form thêm
  const READONLY_STATUSES = [
    'delivered', 'cancelled',
    'full_paid', 'pdi_pending', 'pdi_done',
    'invoice_requested', 'invoice_approved',
  ];
  const isReadOnly = READONLY_STATUSES.includes(order.status);

  // ─── State UI ─────────────────────────────────────────────────────────────
  // Hiện form thêm thanh toán ngay — chỉ ẩn khi đã full_paid hoặc readonly
  const [showAddForm, setShowAddForm]     = useState(!isReadOnly);
  const [activeTab, setActiveTab]         = useState<AddTab>('bank_transfer');
  // Sub-mode trong tab Chuyển khoản: 'qr' = SEPay tự đối chiếu | 'manual' = cần ảnh + KT xác nhận
  const [ckMode, setCkMode]               = useState<'qr' | 'manual'>('qr');

  // State form CK / tiền mặt
  const defaultForm: PaymentFormState = {
    amount: '',
    payment_date: todayISO(),
    notes: '',
    transfer_screenshot_url: '',
  };
  const [form, setForm] = useState<PaymentFormState>(defaultForm);

  // Trạng thái upload ảnh CK
  const [uploading, setUploading]         = useState(false);
  // React 19: useRef trả về RefObject<T | null> — dùng HTMLInputElement | null
  const fileInputRef                      = useRef<HTMLInputElement | null>(null);

  // Map id → ConfirmForm (chỉ hiện khi expand)
  const [confirmForms, setConfirmForms]   = useState<Record<string, ConfirmFormState>>({});
  const [expandedConfirm, setExpandedConfirm] = useState<Record<string, boolean>>({});

  // ─── Query lấy danh sách thanh toán ──────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: ['order-payments', orderId],
    queryFn: async () => {
      const res = await api.get<{ payments: OrderPayment[]; summary: PaymentSummary }>(
        `/sales/${orderId}/payments`,
      );
      return res.data;
    },
    staleTime: 15_000,
  });

  const payments: OrderPayment[] = data?.payments ?? [];
  const summary: PaymentSummary = data?.summary ?? {
    total_amount:  order.total_amount,
    total_paid:    0,
    total_pending: 0,
    remaining:     order.total_amount,
  };

  // ─── QR Polling: mỗi 5 giây khi đang hiện QR (tab QR SEPay hoặc tab CK mode QR) ───

  // Polling kích hoạt khi: tab CK + mode QR
  const isQrPollingActive = showAddForm && activeTab === 'bank_transfer' && ckMode === 'qr';

  const prevRemainingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isQrPollingActive) {
      prevRemainingRef.current = null;
      return;
    }

    // Khởi tạo giá trị tham chiếu
    if (prevRemainingRef.current === null) {
      prevRemainingRef.current = summary.remaining;
    }

    const timer = setInterval(async () => {
      try {
        const res = await api.get<{ payments: OrderPayment[]; summary: PaymentSummary }>(
          `/sales/${orderId}/payments`,
        );
        const newRemaining = res.data.summary.remaining;

        if (
          prevRemainingRef.current !== null &&
          newRemaining < prevRemainingRef.current
        ) {
          toast.success('✅ Đã nhận thanh toán!');
          prevRemainingRef.current = newRemaining;
          void queryClient.invalidateQueries({ queryKey: ['order-payments', orderId] });
          void queryClient.invalidateQueries({ queryKey: ['sales-detail', orderId] });
          setShowAddForm(false);
        } else {
          prevRemainingRef.current = newRemaining;
        }
      } catch {
        // Bỏ qua lỗi poll — không làm ảnh hưởng UI
      }
    }, 5_000);

    return () => clearInterval(timer);
  }, [isQrPollingActive, orderId, summary.remaining, queryClient]);

  // ─── Mutation: tạo payment mới ───────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (body: {
      payment_method: 'cash' | 'bank_transfer';
      amount: number;
      payment_date: string;
      transfer_screenshot_url?: string;
      notes?: string;
    }) => {
      const res = await api.post(`/sales/${orderId}/payments`, body);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Đã gửi xác nhận cho kế toán');
      void queryClient.invalidateQueries({ queryKey: ['order-payments', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['sales-detail', orderId] });
      setForm(defaultForm);
      setShowAddForm(false);
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { error?: string; details?: { field: string; message: string }[] } } })?.response?.data;
      const msg = data?.details?.length
        ? data.details.map(d => d.message).join(', ')
        : (data?.error ?? 'Không thể tạo thanh toán');
      toast.error(msg);
    },
  });

  // ─── Mutation: xác nhận payment ──────────────────────────────────────────

  const confirmMutation = useMutation({
    mutationFn: async ({
      paymentId,
      body,
    }: {
      paymentId: string;
      body: { receipt_number?: string; bank_reference?: string; notes?: string };
    }) => {
      const res = await api.patch(`/sales/${orderId}/payments/${paymentId}/confirm`, body);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      toast.success('Đã xác nhận thanh toán');
      setExpandedConfirm((prev) => ({ ...prev, [variables.paymentId]: false }));
      void queryClient.invalidateQueries({ queryKey: ['order-payments', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['sales-detail', orderId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Không thể xác nhận thanh toán';
      toast.error(msg);
    },
  });

  // ─── Mutation: huỷ payment ───────────────────────────────────────────────

  const cancelMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await api.delete(`/sales/${orderId}/payments/${paymentId}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Đã huỷ thanh toán');
      void queryClient.invalidateQueries({ queryKey: ['order-payments', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['sales-detail', orderId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Không thể huỷ thanh toán';
      toast.error(msg);
    },
  });

  // ─── Upload ảnh chuyển khoản ─────────────────────────────────────────────

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<{ url: string }>(
        '/upload/image?bucket=payment-screenshots&folder=ck',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setForm((prev) => ({ ...prev, transfer_screenshot_url: res.data.url }));
      toast.success('Đã tải ảnh chuyển khoản lên');
    } catch {
      toast.error('Không thể tải ảnh lên. Vui lòng thử lại.');
    } finally {
      setUploading(false);
    }
  }

  // ─── Submit form CK / tiền mặt ───────────────────────────────────────────

  function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    // Xoá dấu chấm ngăn cách nghìn (format VN: 1.000.000) trước khi parse
    const amount = parseInt(form.amount.replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
    if (!amount || amount <= 0) {
      toast.error('Vui lòng nhập số tiền hợp lệ');
      return;
    }
    if (!form.payment_date) {
      toast.error('Vui lòng chọn ngày');
      return;
    }
    const method = activeTab === 'bank_transfer' ? 'bank_transfer' : 'cash';
    createMutation.mutate({
      payment_method: method,
      amount,
      payment_date: form.payment_date,
      transfer_screenshot_url: form.transfer_screenshot_url || undefined,
      notes: form.notes || undefined,
    });
  }

  // ─── Submit xác nhận payment ─────────────────────────────────────────────

  function handleConfirmPayment(paymentId: string) {
    const cf = confirmForms[paymentId] ?? { receipt_number: '', bank_reference: '', notes: '' };
    confirmMutation.mutate({
      paymentId,
      body: {
        receipt_number:  cf.receipt_number  || undefined,
        bank_reference:  cf.bank_reference  || undefined,
        notes:           cf.notes           || undefined,
      },
    });
  }

  // ─── Hàm cập nhật confirm form theo id ───────────────────────────────────

  function updateConfirmForm(paymentId: string, field: keyof ConfirmFormState, value: string) {
    setConfirmForms((prev) => ({
      ...prev,
      [paymentId]: { ...(prev[paymentId] ?? { receipt_number: '', bank_reference: '', notes: '' }), [field]: value },
    }));
  }

  // ─── Tính QR cho Chuyển khoản (dựa vào số tiền nhập trong form) ─────────

  const ckAmountRaw = parseInt(form.amount.replace(/[^0-9]/g, '') || '0', 10);
  const ckQrAmount  = ckAmountRaw > 0 ? ckAmountRaw : Math.max(0, summary.remaining);
  const ckQrUrl = buildSePayQRUrl({
    bank:           paymentSettings?.bank_code    ?? 'VCB',
    account_number: paymentSettings?.bank_account ?? '',
    amount:         ckQrAmount,
    description:    order.order_number,
    template:       'compact2',
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Card tóm tắt tài chính ────────────────────────────────────────── */}
      <div style={{
        background: '#fff',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '18px 20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#1e293b' }}>
          💰 THANH TOÁN
        </div>

        <SummaryRow label="Tổng đơn" value={summary.total_amount} color="#1e293b" bold />

        <SummaryRow
          label="Đã xác nhận"
          value={summary.total_paid}
          color={C.green}
          icon="✅"
        />

        {summary.total_pending > 0 && (
          <SummaryRow
            label="Chờ xác nhận"
            value={summary.total_pending}
            color={C.yellow}
            icon="🟡"
          />
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, margin: '10px 0' }} />

        <SummaryRow
          label="Công nợ còn"
          value={summary.remaining}
          color={summary.remaining <= 0 ? C.green : C.red}
          icon={summary.remaining <= 0 ? '✅' : '🔴'}
          bold
        />
      </div>

      {/* ── Card lịch sử thanh toán ───────────────────────────────────────── */}
      <div style={{
        background: '#fff',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '18px 20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#1e293b' }}>
          📋 Lịch sử thanh toán
        </div>

        {isLoading && (
          <div style={{ color: C.muted, textAlign: 'center', padding: '16px 0' }}>
            Đang tải...
          </div>
        )}

        {isError && (
          <div style={{ color: C.red, textAlign: 'center', padding: '16px 0' }}>
            Không thể tải lịch sử thanh toán.
          </div>
        )}

        {!isLoading && !isError && payments.length === 0 && (
          <div style={{ color: C.muted, textAlign: 'center', padding: '16px 0', fontSize: 14 }}>
            Chưa có thanh toán nào.
          </div>
        )}

        {payments.map((p) => (
          <PaymentItem
            key={p.id}
            payment={p}
            canConfirmRole={canConfirm(userRole)}
            confirmForm={confirmForms[p.id] ?? { receipt_number: '', bank_reference: '', notes: '' }}
            isExpanded={!!expandedConfirm[p.id]}
            onToggleExpand={() =>
              setExpandedConfirm((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
            }
            onUpdateConfirmForm={(field, val) => updateConfirmForm(p.id, field, val)}
            onConfirm={() => handleConfirmPayment(p.id)}
            onCancel={() => {
              if (window.confirm('Bạn có chắc muốn huỷ thanh toán này?')) {
                cancelMutation.mutate(p.id);
              }
            }}
            isConfirming={confirmMutation.isPending && confirmMutation.variables?.paymentId === p.id}
            isCancelling={cancelMutation.isPending && cancelMutation.variables === p.id}
          />
        ))}
      </div>

      {/* ── Card thêm thanh toán (ẩn khi đơn đã hoàn thành/huỷ) ─────────── */}
      {!isReadOnly && (
        <div style={{
          background: '#fff',
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: '18px 20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          {!showAddForm ? (
            <button
              onClick={() => { setShowAddForm(true); setActiveTab('bank_transfer'); setForm(defaultForm); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: C.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                padding: '9px 20px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Thêm thanh toán
            </button>
          ) : (
            <div>
              {/* Header form */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>
                  Thêm thanh toán
                </span>
                <button
                  onClick={() => setShowAddForm(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 20,
                    cursor: 'pointer',
                    color: C.muted,
                    lineHeight: 1,
                    padding: 0,
                  }}
                  title="Đóng"
                >
                  ×
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {(
                  [
                    { key: 'bank_transfer', label: '🏦 Chuyển khoản' },
                    { key: 'cash',          label: '💵 Tiền mặt'     },
                  ] as { key: AddTab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setActiveTab(t.key); setForm(defaultForm); setCkMode('qr'); }}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 6,
                      border: `1.5px solid ${activeTab === t.key ? C.accent : C.border}`,
                      background: activeTab === t.key ? '#eff6ff' : '#fff',
                      color: activeTab === t.key ? C.accent : '#374151',
                      fontWeight: activeTab === t.key ? 700 : 400,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Nội dung tab */}
              {activeTab === 'bank_transfer' && (
                <div>
                  {/* ── Toggle sub-mode ────────────────────────────────── */}
                  <div style={{ display: 'flex', gap: 0, marginBottom: 16, border: `1.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    {([
                      { key: 'qr',     label: '📱 Qua QR (tự đối chiếu)' },
                      { key: 'manual', label: '🖊 Thủ công (cần xác nhận)' },
                    ] as { key: 'qr' | 'manual'; label: string }[]).map((m, i) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => { setCkMode(m.key); setForm(defaultForm); }}
                        style={{
                          flex: 1,
                          padding: '8px 4px',
                          fontSize: 12,
                          fontWeight: ckMode === m.key ? 700 : 400,
                          cursor: 'pointer',
                          border: 'none',
                          borderLeft: i > 0 ? `1.5px solid ${C.border}` : 'none',
                          background: ckMode === m.key ? '#1e40af' : '#f8fafc',
                          color: ckMode === m.key ? '#fff' : '#374151',
                          transition: 'background 0.15s',
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {/* ── Mode QR: SEPay tự đối chiếu ─────────────────────── */}
                  {ckMode === 'qr' && (
                    <div>
                      {/* Ô nhập số tiền — QR update realtime */}
                      <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>
                          Số tiền <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(để trống = toàn bộ công nợ)</span>
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.amount}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^0-9]/g, '');
                              const formatted = raw ? Number(raw).toLocaleString('vi-VN') : '';
                              setForm((prev) => ({ ...prev, amount: formatted }));
                            }}
                            placeholder={`${Math.max(0, summary.remaining).toLocaleString('vi-VN')} (công nợ còn lại)`}
                            style={{ ...inputStyle, paddingRight: 32 }}
                          />
                          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: C.muted, pointerEvents: 'none' }}>₫</span>
                        </div>
                      </div>

                      {/* QR + thông tin tài khoản */}
                      <BankTransferQR
                        qrUrl={ckQrUrl}
                        amount={ckQrAmount}
                        orderNumber={order.order_number}
                        bankName={paymentSettings?.bank_name}
                        bankAccount={paymentSettings?.bank_account}
                        bankAccountName={paymentSettings?.bank_account_name}
                        hasBankConfig={!!(paymentSettings?.bank_code && paymentSettings?.bank_account)}
                        isPolling={isQrPollingActive}
                        autoConfirm
                      />
                    </div>
                  )}

                  {/* ── Mode Thủ công: cần ảnh CK + kế toán xác nhận ──── */}
                  {ckMode === 'manual' && (
                    <form onSubmit={handleSubmitPayment}>
                      <div style={{
                        background: '#fffbeb',
                        border: `1px solid #fde68a`,
                        borderRadius: 8,
                        padding: '8px 12px',
                        marginBottom: 14,
                        fontSize: 12,
                        color: '#92400e',
                        lineHeight: 1.6,
                      }}>
                        ℹ️ Dùng khi khách <strong>không dùng QR</strong>. Sau khi chuyển khoản, TVBH chụp màn hình CK rồi gửi kế toán xác nhận bằng số bút toán.
                      </div>
                      <PaymentFormFields
                        form={form}
                        setForm={setForm}
                        showScreenshot
                        uploading={uploading}
                        fileInputRef={fileInputRef}
                        onFileChange={(file) => { void handleImageUpload(file); }}
                        dateLabel="Ngày chuyển khoản"
                      />
                      <button
                        type="submit"
                        disabled={createMutation.isPending || uploading}
                        style={btnPrimaryStyle(createMutation.isPending || uploading)}
                      >
                        {createMutation.isPending ? 'Đang gửi...' : 'Gửi xác nhận cho kế toán'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {activeTab === 'cash' && (
                <form onSubmit={handleSubmitPayment}>
                  <PaymentFormFields
                    form={form}
                    setForm={setForm}
                    showScreenshot={false}
                    uploading={false}
                    fileInputRef={fileInputRef}
                    onFileChange={() => {}}
                    dateLabel="Ngày thu tiền"
                  />
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    style={btnPrimaryStyle(createMutation.isPending)}
                  >
                    {createMutation.isPending ? 'Đang gửi...' : 'Gửi xác nhận cho kế toán'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-component: dòng tóm tắt số tiền
// ════════════════════════════════════════════════════════════════════════════

interface SummaryRowProps {
  label: string;
  value: number;
  color: string;
  icon?: string;
  bold?: boolean;
}

function SummaryRow({ label, value, color, icon, bold }: SummaryRowProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 0',
    }}>
      <span style={{ fontSize: 14, color: '#374151' }}>{label}:</span>
      <span style={{
        fontSize: 14,
        color,
        fontWeight: bold ? 700 : 500,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {formatCurrency(value)}
        {icon && <span>{icon}</span>}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-component: thẻ 1 payment trong lịch sử
// ════════════════════════════════════════════════════════════════════════════

interface PaymentItemProps {
  payment: OrderPayment;
  canConfirmRole: boolean;
  confirmForm: ConfirmFormState;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdateConfirmForm: (field: keyof ConfirmFormState, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
  isCancelling: boolean;
}

function PaymentItem({
  payment,
  canConfirmRole,
  confirmForm,
  isExpanded,
  onToggleExpand,
  onUpdateConfirmForm,
  onConfirm,
  onCancel,
  isConfirming,
  isCancelling,
}: PaymentItemProps) {
  const isPending   = payment.status === 'pending';
  const isConfirmed = payment.status === 'confirmed';
  const isCancelled = payment.status === 'cancelled';

  const statusIcon  = isConfirmed ? '✅' : isPending ? '🟡' : '❌';
  const statusLabel = isConfirmed ? 'Đã xác nhận' : isPending ? 'Chờ xác nhận' : 'Đã huỷ';
  const statusColor = isConfirmed ? C.green : isPending ? C.yellow : C.muted;

  return (
    <div style={{
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: '12px 14px',
      marginBottom: 10,
      background: isCancelled ? '#f9fafb' : '#fff',
      opacity: isCancelled ? 0.7 : 1,
    }}>
      {/* Dòng 1: phương thức · số tiền · ngày */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
          {getMethodLabel(payment.payment_method)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
            {formatCurrency(payment.amount)}
          </span>
          <span style={{ fontSize: 13, color: C.muted }}>
            {formatDate(payment.payment_date)}
          </span>
        </div>
      </div>

      {/* Dòng 2: trạng thái · mã tham chiếu · badge ghi sổ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>
          {statusIcon} {statusLabel}
        </span>
        {/* Badge ghi sổ finance — chỉ hiện khi confirmed */}
        {isConfirmed && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 10,
            background: payment.finance_transaction_id ? '#dcfce7' : '#fef9c3',
            color:      payment.finance_transaction_id ? '#15803d' : '#854d0e',
            border:     `1px solid ${payment.finance_transaction_id ? '#86efac' : '#fde047'}`,
          }}>
            {payment.finance_transaction_id ? '📒 Đã ghi sổ' : '⚠️ Chưa ghi sổ'}
          </span>
        )}
        {payment.receipt_number && (
          <span style={{ fontSize: 12, color: C.muted }}>· Số phiếu: {payment.receipt_number}</span>
        )}
        {payment.bank_reference && (
          <span style={{ fontSize: 12, color: C.muted }}>· Ref: {payment.bank_reference}</span>
        )}
        {payment.sepay_transaction_id && (
          <span style={{ fontSize: 12, color: C.muted }}>· SEPay #{payment.sepay_transaction_id}</span>
        )}
        {payment.transfer_screenshot_url && (
          <a
            href={payment.transfer_screenshot_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: C.accent, textDecoration: 'none' }}
          >
            📎 Xem ảnh CK
          </a>
        )}
      </div>

      {/* Dòng 3: ghi chú & người tạo */}
      {(payment.notes || payment.created_by_user) && (
        <div style={{ marginTop: 5 }}>
          {payment.notes && (
            <span style={{ fontSize: 12, color: C.muted }}>Ghi chú: {payment.notes}</span>
          )}
          {payment.created_by_user && (
            <span style={{ fontSize: 12, color: C.muted, marginLeft: payment.notes ? 8 : 0 }}>
              · Người gửi: {payment.created_by_user.full_name}
            </span>
          )}
        </div>
      )}

      {/* Dòng 4: người xác nhận */}
      {payment.confirmed_by_user && payment.confirmed_at && (
        <div style={{ fontSize: 12, color: C.green, marginTop: 3 }}>
          Xác nhận bởi {payment.confirmed_by_user.full_name} lúc {formatDate(payment.confirmed_at)}
        </div>
      )}

      {/* Vùng confirm (chỉ hiện với role đủ quyền & payment đang pending) */}
      {canConfirmRole && isPending && (
        <div style={{ marginTop: 10 }}>
          {!isExpanded ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onToggleExpand}
                style={btnSmallStyle(C.green)}
              >
                ✅ Xác nhận
              </button>
              <button
                onClick={onCancel}
                disabled={isCancelling}
                style={btnSmallStyle(C.red)}
              >
                {isCancelling ? 'Đang huỷ...' : '❌ Huỷ'}
              </button>
            </div>
          ) : (
            <div style={{
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              padding: '12px 14px',
              marginTop: 6,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#1e293b' }}>
                Xác nhận thanh toán
              </div>

              <label style={labelStyle}>Số bút toán / Số phiếu thu</label>
              <input
                type="text"
                value={confirmForm.receipt_number}
                onChange={(e) => onUpdateConfirmForm('receipt_number', e.target.value)}
                placeholder="PT2026001 (tuỳ chọn)"
                style={inputStyle}
              />

              <label style={labelStyle}>Mã tham chiếu ngân hàng</label>
              <input
                type="text"
                value={confirmForm.bank_reference}
                onChange={(e) => onUpdateConfirmForm('bank_reference', e.target.value)}
                placeholder="Mã giao dịch (tuỳ chọn)"
                style={inputStyle}
              />

              <label style={labelStyle}>Ghi chú</label>
              <input
                type="text"
                value={confirmForm.notes}
                onChange={(e) => onUpdateConfirmForm('notes', e.target.value)}
                placeholder="Ghi chú (tuỳ chọn)"
                style={inputStyle}
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button
                  onClick={onConfirm}
                  disabled={isConfirming}
                  style={btnSmallStyle(C.green)}
                >
                  {isConfirming ? 'Đang xác nhận...' : '✅ Xác nhận'}
                </button>
                <button
                  onClick={onCancel}
                  disabled={isCancelling}
                  style={btnSmallStyle(C.red)}
                >
                  {isCancelling ? 'Đang huỷ...' : '❌ Huỷ'}
                </button>
                <button
                  onClick={onToggleExpand}
                  style={{
                    ...btnSmallStyle(C.muted),
                    background: '#f3f4f6',
                    color: '#374151',
                  }}
                >
                  Đóng
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helper InfoRow dùng trong BankTransferQR ────────────────────────────────

function InfoRow({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', gap: 8 }}>
      <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{label}:</span>
      <span style={{
        fontSize: 12,
        fontWeight: bold ? 700 : 400,
        color: color ?? '#1e293b',
        textAlign: 'right',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-component: QR Chuyển khoản — hiển thị phía trên form CK
// Khác QR SEPay: số tiền thay đổi realtime theo input; không polling; không auto-confirm
// ════════════════════════════════════════════════════════════════════════════

interface BankTransferQRProps {
  qrUrl:            string;
  amount:           number;
  orderNumber:      string;
  bankName?:        string;
  bankAccount?:     string;
  bankAccountName?: string;
  hasBankConfig:    boolean;
  isPolling?:       boolean; // đang poll SEPay
  autoConfirm?:     boolean; // true = SEPay tự đối chiếu, không cần ảnh/KT
}

function BankTransferQR({
  qrUrl,
  amount,
  orderNumber,
  bankName,
  bankAccount,
  bankAccountName,
  hasBankConfig,
  isPolling  = false,
  autoConfirm = false,
}: BankTransferQRProps) {
  if (!hasBankConfig) {
    return (
      <div style={{
        background: '#fffbeb',
        border: `1px dashed #fbbf24`,
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
        fontSize: 12,
        color: '#92400e',
        textAlign: 'center',
      }}>
        ⚙️ Chưa cấu hình ngân hàng — vào <strong>Cấu hình → Thanh toán & SEPay</strong> để hiện QR
      </div>
    );
  }

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 16,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
    }}>
      {/* Tiêu đề + trạng thái polling */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          📷 QR chuyển khoản
          <span style={{ fontWeight: 400, color: C.muted, marginLeft: 6, fontSize: 12 }}>
            (cập nhật theo số tiền nhập)
          </span>
        </span>
        {/* Dot chờ — chỉ hiện khi autoConfirm + đang poll */}
        {autoConfirm && isPolling && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.green }}>
            <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22c55e', opacity: 0.7, animation: 'ping 1.2s ease-out infinite' }} />
              <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'block' }} />
            </span>
            <style>{`@keyframes ping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}`}</style>
            Đang chờ
          </span>
        )}
      </div>

      {/* QR image */}
      <div style={{
        border: `2px solid ${C.border}`,
        borderRadius: 10,
        padding: 8,
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      }}>
        <img
          src={qrUrl}
          alt="QR chuyển khoản"
          width={160}
          height={160}
          style={{ display: 'block', borderRadius: 6 }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      </div>

      {/* Thông tin tài khoản */}
      <div style={{
        background: '#fff',
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        width: '100%',
        maxWidth: 280,
      }}>
        {bankName        && <InfoRow label="Ngân hàng" value={bankName} />}
        {bankAccount     && <InfoRow label="Số TK"     value={bankAccount} bold />}
        {bankAccountName && <InfoRow label="Chủ TK"    value={bankAccountName} />}
        <InfoRow label="Nội dung" value={orderNumber} bold />
        <InfoRow label="Số tiền"  value={formatCurrency(amount)} bold color={C.accent} />
      </div>

      {/* Chú thích — khác nhau theo mode */}
      {autoConfirm ? (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: '#eff6ff', border: `1px solid #bfdbfe`,
          borderRadius: 8, padding: '8px 12px', width: '100%', fontSize: 12, color: '#1d4ed8', lineHeight: 1.6,
        }}>
          <span style={{ fontSize: 15 }}>⚡</span>
          <span>SEPay tự động đối chiếu sau khi khách chuyển. <strong>Không cần ảnh CK, không cần kế toán xác nhận.</strong></span>
        </div>
      ) : (
        <div style={{
          fontSize: 11, color: '#92400e', background: '#fffbeb',
          border: `1px solid #fde68a`, borderRadius: 7,
          padding: '6px 12px', textAlign: 'center', lineHeight: 1.6, width: '100%',
        }}>
          ⚠️ Sau khi khách chuyển, TVBH chụp màn hình CK và gửi xác nhận.<br />
          Kế toán xác nhận bằng cách nhập số bút toán ngân hàng.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-component: Form nhập thông tin CK / tiền mặt
// ════════════════════════════════════════════════════════════════════════════

interface PaymentFormFieldsProps {
  form: PaymentFormState;
  setForm: React.Dispatch<React.SetStateAction<PaymentFormState>>;
  showScreenshot: boolean;
  uploading: boolean;
  // React 19: useRef trả về RefObject<T | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (file: File) => void;
  dateLabel: string;
}

function PaymentFormFields({
  form,
  setForm,
  showScreenshot,
  uploading,
  fileInputRef,
  onFileChange,
  dateLabel,
}: PaymentFormFieldsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      {/* Số tiền */}
      <div>
        <label style={labelStyle}>
          Số tiền <span style={{ color: C.red }}>*</span>
        </label>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            inputMode="numeric"
            value={form.amount}
            onChange={(e) => {
              // Chỉ cho nhập số
              const raw = e.target.value.replace(/[^0-9]/g, '');
              // Hiển thị có dấu phân cách nghìn
              const formatted = raw ? Number(raw).toLocaleString('vi-VN') : '';
              setForm((prev) => ({ ...prev, amount: formatted }));
            }}
            placeholder="0"
            required
            style={{ ...inputStyle, paddingRight: 32 }}
          />
          <span style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 13,
            color: C.muted,
            pointerEvents: 'none',
          }}>
            ₫
          </span>
        </div>
      </div>

      {/* Ngày */}
      <div>
        <label style={labelStyle}>
          {dateLabel} <span style={{ color: C.red }}>*</span>
        </label>
        <input
          type="date"
          value={form.payment_date}
          onChange={(e) => setForm((prev) => ({ ...prev, payment_date: e.target.value }))}
          required
          style={inputStyle}
        />
      </div>

      {/* Ảnh chuyển khoản (chỉ CK) */}
      {showScreenshot && (
        <div>
          <label style={labelStyle}>Ảnh chuyển khoản</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                background: '#f3f4f6',
                border: `1.5px dashed ${C.border}`,
                borderRadius: 7,
                padding: '8px 14px',
                fontSize: 13,
                color: '#374151',
                cursor: uploading ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              {uploading
                ? '⏳ Đang tải ảnh...'
                : form.transfer_screenshot_url
                  ? '✅ Đã tải ảnh · Nhấn để đổi'
                  : '📎 Chọn ảnh chuyển khoản'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileChange(file);
              }}
            />
            {form.transfer_screenshot_url && (
              <a
                href={form.transfer_screenshot_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: C.accent }}
              >
                Xem ảnh đã tải
              </a>
            )}
          </div>
        </div>
      )}

      {/* Ghi chú */}
      <div>
        <label style={labelStyle}>Ghi chú</label>
        <input
          type="text"
          value={form.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="Ghi chú thêm (tuỳ chọn)"
          style={inputStyle}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Style helpers
// ════════════════════════════════════════════════════════════════════════════

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: `1.5px solid ${C.border}`,
  borderRadius: 7,
  fontSize: 14,
  color: '#1e293b',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

function btnPrimaryStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#93c5fd' : C.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    padding: '9px 22px',
    fontWeight: 600,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
  };
}

function btnSmallStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  };
}
