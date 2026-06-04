// Trang Thu Chi Tài chính
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import type { FinanceTransaction, PaginatedResponse } from '../types';
import { formatCurrency, formatDate, PAYMENT_METHOD } from '../utils/helpers';
import { useAuthStore } from '../store/authStore';

const CATEGORY_LABEL: Record<string, string> = {
  ban_hang:                 'Bán hàng',
  bao_hanh:                 'Bảo hành',
  mua_hang:                 'Mua hàng',
  luong:                    'Lương',
  dien_nuoc:                'Điện nước',
  khac:                     'Khác',
  chuyen_khoan_khong_khop:  '⚠️ CK không khớp',
};

// ── Tab Chờ xác nhận ──────────────────────────────────────────────────────────
interface PendingPayment {
  id:           string;
  order_id:     string;
  amount:       number;
  payment_method: string;
  payment_date: string;
  notes:        string | null;
  transfer_screenshot_url: string | null;
  created_at:   string;
  sales_orders: {
    id:           string;
    order_number: string;
    total_amount: number;
    status:       string;
    customers:    { id: string; full_name: string; phone: string } | null;
  };
}

interface ConfirmForm { receipt_number: string; bank_reference: string; notes: string; }
const defaultConfirm = (): ConfirmForm => ({ receipt_number: '', bank_reference: '', notes: '' });

function TabPendingPayments() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage]           = useState(1);
  const [methodFilter, setMethod] = useState('');
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});
  const [forms, setForms]         = useState<Record<string, ConfirmForm>>({});

  const { data, isLoading } = useQuery<PaginatedResponse<PendingPayment>>({
    queryKey: ['pending-payments', methodFilter, page],
    queryFn: () => api.get('/finance/pending-payments', {
      params: { method: methodFilter || undefined, page, limit: 20 },
    }).then(r => r.data),
    refetchInterval: 15_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pending-payments'] });

  const confirmMut = useMutation({
    mutationFn: ({ orderId, paymentId, body }: { orderId: string; paymentId: string; body: ConfirmForm }) =>
      api.patch(`/finance/pending-payments/${orderId}/${paymentId}/confirm`, body).then(r => r.data),
    onSuccess: (_d, { paymentId }) => {
      toast.success('Đã xác nhận thanh toán');
      setExpanded(prev => ({ ...prev, [paymentId]: false }));
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Không thể xác nhận'),
  });

  const cancelMut = useMutation({
    mutationFn: ({ orderId, paymentId }: { orderId: string; paymentId: string }) =>
      api.delete(`/finance/pending-payments/${orderId}/${paymentId}`).then(r => r.data),
    onSuccess: () => { toast.success('Đã huỷ thanh toán'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Không thể huỷ'),
  });

  const totalPages = Math.ceil((data?.total ?? 0) / 20);

  const updateForm = (id: string, field: keyof ConfirmForm, val: string) =>
    setForms(prev => ({ ...prev, [id]: { ...(prev[id] ?? defaultConfirm()), [field]: val } }));

  const handleConfirm = (p: PendingPayment) => {
    confirmMut.mutate({
      orderId:   p.sales_orders.id,
      paymentId: p.id,
      body:      forms[p.id] ?? defaultConfirm(),
    });
  };

  const handleCancel = (p: PendingPayment) => {
    if (!window.confirm(`Huỷ thanh toán ${formatCurrency(p.amount)} của đơn ${p.sales_orders.order_number}?`)) return;
    cancelMut.mutate({ orderId: p.sales_orders.id, paymentId: p.id });
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">⏳ Chờ xác nhận ({data?.total ?? 0})</span>
        <select
          className="filter-select"
          value={methodFilter}
          onChange={e => { setMethod(e.target.value); setPage(1); }}
        >
          <option value="">Tất cả phương thức</option>
          <option value="cash">Tiền mặt</option>
          <option value="bank_transfer">Chuyển khoản</option>
          <option value="qr_code">QR Code</option>
        </select>
      </div>

      <div className="table-wrap">
        {isLoading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (data?.data?.length ?? 0) === 0 ? (
          <div className="empty-state"><p>Không có khoản thanh toán nào đang chờ xác nhận 🎉</p></div>
        ) : (
          <table className="mobile-cards">
            <thead>
              <tr>
                <th>Đơn hàng</th>
                <th>Khách hàng</th>
                <th className="hide-mobile">Phương thức</th>
                <th className="hide-mobile">Ngày tạo</th>
                <th className="text-right">Số tiền</th>
                <th className="hide-mobile">Ảnh CK</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map(p => {
                const isEx  = !!expanded[p.id];
                const form  = forms[p.id] ?? defaultConfirm();
                const isCash = p.payment_method === 'cash';
                const isCK   = p.payment_method === 'bank_transfer';

                return (
                  <>
                    <tr key={p.id} style={{ background: isEx ? '#f0fdf4' : undefined }}>
                      {/* Đơn hàng */}
                      <td>
                        <button
                          onClick={() => navigate(`/sales/${p.sales_orders.id}`)}
                          style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: 13, padding: 0 }}
                        >
                          {p.sales_orders.order_number}
                        </button>
                      </td>

                      {/* Khách hàng */}
                      <td data-label="Khách hàng" style={{ fontSize: 13 }}>
                        <div>{p.sales_orders.customers?.full_name ?? '—'}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{p.sales_orders.customers?.phone}</div>
                      </td>

                      {/* Phương thức */}
                      <td data-label="Phương thức" className="hide-mobile" style={{ fontSize: 13 }}>
                        {PAYMENT_METHOD[p.payment_method] ?? p.payment_method}
                      </td>

                      {/* Ngày tạo */}
                      <td data-label="Ngày tạo" className="hide-mobile" style={{ fontSize: 13 }}>{formatDate(p.created_at)}</td>

                      {/* Số tiền */}
                      <td data-label="Số tiền" className="text-right fw-600" style={{ color: '#16a34a' }}>
                        {formatCurrency(p.amount)}
                      </td>

                      {/* Ảnh chuyển khoản */}
                      <td data-label="Ảnh CK" className="hide-mobile">
                        {p.transfer_screenshot_url ? (
                          <a href={p.transfer_screenshot_url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, color: '#2563eb' }}>🖼 Xem ảnh</a>
                        ) : <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>}
                      </td>

                      {/* Nút hành động */}
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #16a34a', background: isEx ? '#dcfce7' : '#fff', color: '#16a34a', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✅ Xác nhận
                          </button>
                          <button
                            onClick={() => handleCancel(p)}
                            disabled={cancelMut.isPending}
                            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #dc2626', background: '#fff', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ❌ Huỷ
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* ── Form xác nhận inline ── */}
                    {isEx && (
                      <tr key={`${p.id}-form`}>
                        <td colSpan={7} style={{ background: '#f0fdf4', padding: '12px 20px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
                            {isCash && (
                              <div>
                                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                                  Số phiếu thu <span style={{ color: '#dc2626' }}>*</span>
                                </label>
                                <input
                                  className="form-input"
                                  placeholder="PT2026001"
                                  value={form.receipt_number}
                                  onChange={e => updateForm(p.id, 'receipt_number', e.target.value)}
                                />
                              </div>
                            )}
                            {isCK && (
                              <div>
                                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                                  Mã tham chiếu NH <span style={{ color: '#dc2626' }}>*</span>
                                </label>
                                <input
                                  className="form-input"
                                  placeholder="Mã giao dịch ngân hàng"
                                  value={form.bank_reference}
                                  onChange={e => updateForm(p.id, 'bank_reference', e.target.value)}
                                />
                              </div>
                            )}
                            <div style={{ gridColumn: (!isCash && !isCK) ? '1 / span 3' : undefined }}>
                              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Ghi chú</label>
                              <input
                                className="form-input"
                                placeholder="Ghi chú (tuỳ chọn)"
                                value={form.notes}
                                onChange={e => updateForm(p.id, 'notes', e.target.value)}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => handleConfirm(p)}
                                disabled={confirmMut.isPending}
                                style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                              >
                                {confirmMut.isPending ? 'Đang lưu...' : '✅ Xác nhận'}
                              </button>
                              <button
                                onClick={() => setExpanded(prev => ({ ...prev, [p.id]: false }))}
                                style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}
                              >
                                Đóng
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">Trang {page}/{totalPages}</span>
          <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
            <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
          ))}
          <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function FinancePage() {
  const { user } = useAuthStore();
  const canConfirm = ['accountant', 'manager', 'admin'].includes(user?.role ?? '');

  const [tab, setTab]             = useState<'history' | 'pending'>('history');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [sepayFilter, setSepayFilter] = useState(false);
  const [page, setPage] = useState(1);

  const { data: summary } = useQuery({
    queryKey: ['finance-summary'],
    queryFn: () => api.get('/finance/summary').then(r => r.data),
    refetchInterval: 30_000,
  });

  // Badge số lượng pending
  const { data: pendingData } = useQuery({
    queryKey: ['pending-payments', '', 1],
    queryFn: () => api.get('/finance/pending-payments', { params: { limit: 1 } }).then(r => r.data),
    enabled: canConfirm,
    refetchInterval: 15_000,
  });
  const pendingCount = pendingData?.total ?? 0;

  const { data, isLoading } = useQuery<PaginatedResponse<FinanceTransaction>>({
    queryKey: ['finance', typeFilter, sepayFilter, page],
    queryFn: () => api.get('/finance', {
      params: { type: typeFilter || undefined, sepay: sepayFilter || undefined, page, limit: 15 },
    }).then(r => r.data),
    enabled: tab === 'history',
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);

  // Style tab
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px',
    borderRadius: '8px 8px 0 0',
    border: active ? '1px solid #e2e8f0' : '1px solid transparent',
    borderBottom: active ? '1px solid #fff' : '1px solid transparent',
    background: active ? '#fff' : 'transparent',
    fontWeight: active ? 600 : 400,
    fontSize: 14,
    cursor: 'pointer',
    color: active ? '#1e293b' : '#6b7280',
    position: 'relative',
    marginBottom: -1,
  });

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💰 Quản lý Thu Chi</span>
      </div>
      <div className="page-content">

        {/* ── Summary ── */}
        {summary && (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 24 }}>
            <div className="stat-card green">
              <div className="label">Tổng Thu — {summary.month}</div>
              <div className="value" style={{ fontSize: 22 }}>{formatCurrency(summary.income)}</div>
            </div>
            <div className="stat-card red">
              <div className="label">Tổng Chi — {summary.month}</div>
              <div className="value" style={{ fontSize: 22 }}>{formatCurrency(summary.expense)}</div>
            </div>
            <div className={`stat-card ${summary.profit >= 0 ? 'blue' : 'orange'}`}>
              <div className="label">Lợi nhuận — {summary.month}</div>
              <div className="value" style={{ fontSize: 22, color: summary.profit >= 0 ? '#16a34a' : '#dc2626' }}>
                {summary.profit >= 0 ? '+' : ''}{formatCurrency(summary.profit)}
              </div>
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 0 }}>
          <button style={tabStyle(tab === 'history')} onClick={() => setTab('history')}>
            📋 Lịch sử giao dịch
          </button>
          {canConfirm && (
            <button style={tabStyle(tab === 'pending')} onClick={() => setTab('pending')}>
              ⏳ Chờ xác nhận
              {pendingCount > 0 && (
                <span style={{
                  marginLeft: 6, background: '#dc2626', color: '#fff',
                  borderRadius: 10, fontSize: 11, fontWeight: 700,
                  padding: '1px 6px', verticalAlign: 'middle',
                }}>
                  {pendingCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* ── Tab: Lịch sử giao dịch ── */}
        {tab === 'history' && (
          <div className="card" style={{ borderRadius: '0 8px 8px 8px' }}>
            <div className="card-header">
              <span className="card-title">Lịch sử giao dịch ({data?.total ?? 0})</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="filter-select" value={typeFilter}
                  onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
                  <option value="">Tất cả loại</option>
                  <option value="income">💚 Thu</option>
                  <option value="expense">🔴 Chi</option>
                </select>
                <button
                  onClick={() => { setSepayFilter(v => !v); setPage(1); }}
                  style={{
                    padding: '5px 12px', borderRadius: 6,
                    border: `1px solid ${sepayFilter ? '#3b82f6' : '#e2e8f0'}`,
                    background: sepayFilter ? '#eff6ff' : '#fff',
                    color: sepayFilter ? '#1d4ed8' : '#6b7280',
                    fontSize: 13, fontWeight: sepayFilter ? 600 : 400,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  ⚡ SEPay{sepayFilter ? ' ✓' : ''}
                </button>
              </div>
            </div>

            <div className="table-wrap">
              {isLoading ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : (data?.data?.length ?? 0) === 0 ? (
                <div className="empty-state">
                  <p>{sepayFilter ? 'Chưa có giao dịch SEPay nào' : 'Không có giao dịch nào'}</p>
                </div>
              ) : (
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th>Mã GD</th>
                      <th>Loại</th>
                      <th className="hide-mobile">Danh mục</th>
                      <th className="hide-mobile">Phương thức</th>
                      <th className="hide-mobile">Mô tả</th>
                      <th className="hide-mobile">Ngày</th>
                      <th className="text-right">Số tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.data.map(t => (
                      <tr key={t.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className="font-mono" style={{ fontSize: 12 }}>{t.transaction_number}</span>
                            {t.sepay_transaction_id && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: '#2563eb', background: '#eff6ff', borderRadius: 4, padding: '1px 5px', width: 'fit-content' }}>
                                ⚡ SEPay #{t.sepay_transaction_id}
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Loại">
                          <span className={`badge ${t.type === 'income' ? 'badge-green' : 'badge-red'}`}>
                            {t.type === 'income' ? '💚 Thu' : '🔴 Chi'}
                          </span>
                        </td>
                        <td data-label="Danh mục" className="text-muted hide-mobile" style={{ fontSize: 13 }}>{CATEGORY_LABEL[t.category] ?? t.category}</td>
                        <td data-label="Phương thức" className="hide-mobile" style={{ fontSize: 13 }}>{PAYMENT_METHOD[t.payment_method] || t.payment_method || '—'}</td>
                        <td data-label="Mô tả" className="text-muted hide-mobile" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }} title={t.description}>
                          {t.description || '—'}
                        </td>
                        <td data-label="Ngày" className="hide-mobile" style={{ fontSize: 13 }}>{formatDate(t.transaction_date)}</td>
                        <td data-label="Số tiền" className="text-right fw-600" style={{ color: t.type === 'income' ? '#16a34a' : '#dc2626' }}>
                          {t.type === 'income' ? '+' : '−'}{formatCurrency(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <span className="pagination-info">Trang {page}/{totalPages}</span>
                <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                  <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Chờ xác nhận ── */}
        {tab === 'pending' && canConfirm && (
          <TabPendingPayments />
        )}

      </div>
    </>
  );
}
