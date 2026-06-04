// Trang Phiếu Dịch Vụ — DMS + QR SEPay / Tiền mặt
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatCurrency, formatDateTime } from '../utils/helpers';
import { buildSePayQRUrl } from '../types/accounting';
import { useAuthStore } from '../store/authStore';
import type { PaymentSettings } from '../types';
import toast from 'react-hot-toast';

interface ServiceTicket {
  id:                     string;
  ticket_code:            string;
  dms_code:               string;
  customer_id:            string | null;
  customer_name:          string | null;
  customer_phone:         string | null;
  amount:                 number;
  payment_method:         'qr_sepay' | 'cash';
  payment_status:         'pending' | 'paid' | 'cancelled';
  sepay_transaction_id:   string | null;
  finance_transaction_id: string | null;
  paid_at:                string | null;
  paid_by:                string | null;
  notes:                  string | null;
  created_at:             string;
  updated_at:             string;
  users?:                 { full_name: string } | null;
  customers?:             { full_name: string; phone: string; loyalty_points: number } | null;
}

interface CustomerLookup {
  id:             string;
  customer_code:  string;
  full_name:      string;
  phone:          string;
  loyalty_points: number;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  pending:   { label: '⏳ Chờ thanh toán', bg: '#fef3c7', color: '#92400e' },
  paid:      { label: '✅ Đã thu',          bg: '#dcfce7', color: '#15803d' },
  cancelled: { label: '❌ Đã hủy',           bg: '#fee2e2', color: '#991b1b' },
};

export default function ServiceTicketsPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canConfirmCash = ['admin', 'manager', 'accountant'].includes(user?.role ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [qrTicket, setQrTicket]         = useState<ServiceTicket | null>(null);
  const [viewTicket, setViewTicket]     = useState<ServiceTicket | null>(null);

  // Form thêm phiếu
  const [formDms, setFormDms]                   = useState('');
  const [formAmount, setFormAmount]             = useState('');
  const [formNotes, setFormNotes]               = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<'qr_sepay' | 'cash'>('qr_sepay');

  // Tra KH theo SĐT — bắt buộc gắn KH (3A)
  const [phoneSearch, setPhoneSearch]   = useState('');
  const [chosenCustomer, setChosenCustomer] = useState<CustomerLookup | null>(null);
  const [showCreateCust, setShowCreateCust] = useState(false);
  const [newCustName, setNewCustName]   = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');

  // Tra KH bằng SĐT chính xác (≥ 9 số) — dùng phone_exact endpoint
  const phoneClean = phoneSearch.replace(/\D/g, '');
  const { data: lookupData, isFetching: lookingUp } = useQuery<{ data: CustomerLookup[] }>({
    queryKey: ['service-customer-lookup', phoneClean],
    queryFn:  () => api.get('/customers', {
      params: { phone_exact: phoneClean, limit: 5 },
    }).then(r => r.data),
    enabled: phoneClean.length >= 9 && !chosenCustomer,
    staleTime: 5_000,
  });
  const matchedCustomers = lookupData?.data ?? [];

  // Lấy cấu hình thanh toán (bank info để sinh QR)
  const { data: paySettings } = useQuery<PaymentSettings>({
    queryKey: ['payment-settings'],
    queryFn:  () => api.get('/settings/payment').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // Danh sách phiếu — auto refresh mỗi 4s để bắt webhook SEPay nhanh
  const { data, isLoading } = useQuery<{ data: ServiceTicket[]; total: number }>({
    queryKey: ['service-tickets', statusFilter, search],
    queryFn:  () => api.get('/service-tickets', {
      params: { status: statusFilter || undefined, search: search || undefined },
    }).then(r => r.data),
    refetchInterval: 4_000,
  });

  const tickets = data?.data ?? [];

  // Mutation tạo phiếu
  const createMut = useMutation({
    mutationFn: (body: any) => api.post('/service-tickets', body).then(r => r.data),
    onSuccess: (newTicket) => {
      toast.success(`✅ Đã tạo phiếu ${newTicket.ticket_code}`);
      qc.invalidateQueries({ queryKey: ['service-tickets'] });
      setShowNewModal(false);
      resetForm();
      // QR mode: mở modal QR luôn; Cash mode: chỉ thông báo, chờ kế toán confirm
      if (newTicket.payment_method === 'qr_sepay') {
        setQrTicket(newTicket);
      } else {
        toast('💵 Phiếu chờ kế toán xác nhận thu tiền mặt', { icon: '⏳' });
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo phiếu'),
  });

  // Mutation xác nhận thu tiền mặt
  const confirmCashMut = useMutation({
    mutationFn: (id: string) => api.patch(`/service-tickets/${id}/confirm-cash`).then(r => r.data),
    onSuccess: (updated) => {
      toast.success(`✅ Đã thu tiền mặt phiếu ${updated.ticket_code}`);
      qc.invalidateQueries({ queryKey: ['service-tickets'] });
      setQrTicket(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi xác nhận'),
  });

  // Mutation hủy phiếu
  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/service-tickets/${id}/cancel`).then(r => r.data),
    onSuccess: () => {
      toast.success('Đã hủy phiếu');
      qc.invalidateQueries({ queryKey: ['service-tickets'] });
      setQrTicket(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi hủy phiếu'),
  });

  // Mutation tạo KH mới
  const createCustMut = useMutation({
    mutationFn: (body: any) => api.post('/customers', body).then(r => r.data),
    onSuccess: (kh) => {
      toast.success(`Đã tạo KH ${kh.full_name}`);
      setChosenCustomer({
        id:             kh.id,
        customer_code:  kh.customer_code,
        full_name:      kh.full_name,
        phone:          kh.phone,
        loyalty_points: kh.loyalty_points || 0,
      });
      setShowCreateCust(false);
      setNewCustName(''); setNewCustAddress('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo KH'),
  });

  function resetForm() {
    setFormDms(''); setFormAmount('');
    setFormNotes('');
    setFormPaymentMethod('qr_sepay');
    setPhoneSearch(''); setChosenCustomer(null);
    setShowCreateCust(false); setNewCustName(''); setNewCustAddress('');
  }

  function submitCreate() {
    const dms = formDms.trim();
    const amt = parseInt(formAmount.replace(/\D/g, '') || '0', 10);
    if (!dms)   { toast.error('Nhập mã lệnh DMS'); return; }
    if (!amt || amt <= 0) { toast.error('Số tiền phải lớn hơn 0'); return; }
    if (!chosenCustomer) { toast.error('Phải chọn hoặc tạo khách hàng'); return; }

    createMut.mutate({
      dms_code:       dms,
      amount:         amt,
      payment_method: formPaymentMethod,
      customer_id:    chosenCustomer.id,
      customer_name:  chosenCustomer.full_name,
      customer_phone: chosenCustomer.phone,
      notes:          formNotes.trim() || undefined,
    });
  }

  function submitCreateCustomer() {
    if (!newCustName.trim())   { toast.error('Nhập họ tên KH'); return; }
    if (!phoneClean)           { toast.error('Nhập SĐT'); return; }
    if (!newCustAddress.trim()){ toast.error('Nhập địa chỉ (cần để xuất hóa đơn)'); return; }
    createCustMut.mutate({
      full_name: newCustName.trim(),
      phone:     phoneSearch.trim(),
      address:   newCustAddress.trim(),
    });
  }

  // Sinh URL QR cho phiếu — description chỉ chứa mã DV (webhook match theo ticket_code)
  function getQRUrl(t: ServiceTicket): string | null {
    if (!paySettings?.bank_code || !paySettings?.bank_account) return null;
    return buildSePayQRUrl({
      bank:           paySettings.bank_code,
      account_number: paySettings.bank_account,
      amount:         Number(t.amount),
      description:    t.ticket_code,
      template:       'compact2',
    });
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🔧 Phiếu dịch vụ — DMS</span>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          + Tạo phiếu thu mới
        </button>
      </div>

      <div className="page-content">
        {/* Filters */}
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="form-control"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Tìm theo mã DV / DMS / tên KH / SĐT"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="filter-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Chờ thanh toán</option>
              <option value="paid">Đã thu</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>
        </div>

        {/* Bảng */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Danh sách phiếu ({tickets.length})</span>
          </div>
          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : tickets.length === 0 ? (
              <div className="empty-state"><p>Chưa có phiếu dịch vụ nào</p></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Mã DV</th>
                    <th>Lệnh DMS</th>
                    <th>Khách hàng</th>
                    <th style={{ textAlign: 'right' }}>Số tiền</th>
                    <th>PT</th>
                    <th>Trạng thái</th>
                    <th className="hide-mobile">NV tạo</th>
                    <th className="hide-mobile">Thời gian</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => {
                    const st = STATUS_BADGE[t.payment_status];
                    return (
                      <tr key={t.id}>
                        <td><span className="font-mono text-primary">{t.ticket_code}</span></td>
                        <td><span className="font-mono fw-600">{t.dms_code}</span></td>
                        <td>
                          {t.customer_name || '—'}
                          {t.customer_phone && (
                            <><br /><span className="text-muted" style={{ fontSize: 12 }}>{t.customer_phone}</span></>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(t.amount)}</td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: t.payment_method === 'cash' ? '#dcfce7' : '#dbeafe',
                            color:      t.payment_method === 'cash' ? '#15803d' : '#1d4ed8',
                          }}>
                            {t.payment_method === 'cash' ? '💵 Tiền mặt' : '📱 QR'}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: st.bg, color: st.color,
                          }}>{st.label}</span>
                        </td>
                        <td className="text-muted hide-mobile">{t.users?.full_name ?? '—'}</td>
                        <td className="text-muted hide-mobile" style={{ fontSize: 12 }}>
                          {t.payment_status === 'paid' && t.paid_at
                            ? `Thu: ${formatDateTime(t.paid_at)}`
                            : formatDateTime(t.created_at)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm btn-secondary"
                              onClick={() => setViewTicket(t)} title="Xem chi tiết">
                              👁 Xem
                            </button>
                            {t.payment_status === 'pending' && t.payment_method === 'qr_sepay' && (
                              <button className="btn btn-sm btn-primary" onClick={() => setQrTicket(t)}>
                                📱 Mở QR
                              </button>
                            )}
                            {t.payment_status === 'pending' && t.payment_method === 'cash' && canConfirmCash && (
                              <button
                                className="btn btn-sm"
                                style={{ background: '#16a34a', color: '#fff' }}
                                onClick={() => {
                                  if (confirm(`Xác nhận đã thu ${formatCurrency(t.amount)} tiền mặt cho phiếu ${t.ticket_code}?`)) {
                                    confirmCashMut.mutate(t.id);
                                  }
                                }}
                                disabled={confirmCashMut.isPending}
                              >
                                💵 Thu tiền mặt
                              </button>
                            )}
                            {t.payment_status === 'pending' && t.payment_method === 'cash' && !canConfirmCash && (
                              <span style={{ fontSize: 11, color: '#92400e' }}>⏳ Chờ kế toán</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modal tạo phiếu mới */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">+ Tạo phiếu thu DV mới</span>
              <button className="modal-close" onClick={() => setShowNewModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Mã lệnh DMS <span className="required">*</span></label>
                <input
                  className="form-control"
                  placeholder="VD: WO-2026-12345"
                  value={formDms}
                  onChange={e => setFormDms(e.target.value)}
                  autoFocus
                />
                <small style={{ fontSize: 11, color: '#6b7280' }}>
                  Mã lấy từ hệ thống DMS VinFast — bắt buộc duy nhất
                </small>
              </div>
              <div className="form-group">
                <label className="form-label">Số tiền cần thu <span className="required">*</span></label>
                <input
                  className="form-control"
                  inputMode="numeric"
                  placeholder="0"
                  value={formAmount}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setFormAmount(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                  }}
                />
              </div>

              {/* ── Phương thức thanh toán ── */}
              <div className="form-group">
                <label className="form-label">Phương thức thanh toán <span className="required">*</span></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setFormPaymentMethod('qr_sepay')}
                    style={{
                      padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${formPaymentMethod === 'qr_sepay' ? '#2563eb' : '#e5e7eb'}`,
                      background: formPaymentMethod === 'qr_sepay' ? '#eff6ff' : '#fff',
                      color: formPaymentMethod === 'qr_sepay' ? '#2563eb' : '#6b7280',
                    }}
                  >
                    📱 QR SEPay<br />
                    <span style={{ fontSize: 11, fontWeight: 400 }}>Tự đối chiếu</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormPaymentMethod('cash')}
                    style={{
                      padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${formPaymentMethod === 'cash' ? '#16a34a' : '#e5e7eb'}`,
                      background: formPaymentMethod === 'cash' ? '#f0fdf4' : '#fff',
                      color: formPaymentMethod === 'cash' ? '#16a34a' : '#6b7280',
                    }}
                  >
                    💵 Tiền mặt<br />
                    <span style={{ fontSize: 11, fontWeight: 400 }}>Kế toán xác nhận</span>
                  </button>
                </div>
              </div>

              {/* ── Khách hàng (bắt buộc) ── */}
              <div className="form-group">
                <label className="form-label">
                  Khách hàng <span className="required">*</span>
                </label>
                {chosenCustomer ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', background: '#f0fdf4',
                    border: '1px solid #86efac', borderRadius: 8,
                  }}>
                    <span style={{ fontSize: 20 }}>👤</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: '#15803d' }}>
                        {chosenCustomer.full_name} · {chosenCustomer.customer_code}
                      </div>
                      <div style={{ fontSize: 12, color: '#15803d' }}>
                        📞 {chosenCustomer.phone}
                        {' · '}
                        🏆 {chosenCustomer.loyalty_points.toLocaleString('vi-VN')} điểm
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#dc2626' }}
                      onClick={() => {
                        setChosenCustomer(null);
                        setPhoneSearch('');
                        setShowCreateCust(false);
                      }}
                      title="Đổi KH"
                    >×</button>
                  </div>
                ) : (
                  <>
                    <input
                      className="form-control"
                      placeholder="Nhập SĐT khách hàng (≥ 9 số)"
                      inputMode="numeric"
                      value={phoneSearch}
                      onChange={e => setPhoneSearch(e.target.value.replace(/\D/g, ''))}
                    />
                    {/* Trạng thái lookup */}
                    {phoneClean.length >= 9 && (
                      <div style={{ marginTop: 8 }}>
                        {lookingUp ? (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>Đang tra cứu...</div>
                        ) : matchedCustomers.length > 0 ? (
                          <div style={{
                            background: '#eff6ff', border: '1px solid #bfdbfe',
                            borderRadius: 6, padding: 8,
                          }}>
                            <div style={{ fontSize: 11, color: '#1d4ed8', marginBottom: 6, fontWeight: 600 }}>
                              ✅ Tìm thấy {matchedCustomers.length} KH:
                            </div>
                            {matchedCustomers.map(kh => (
                              <button
                                key={kh.id}
                                type="button"
                                onClick={() => setChosenCustomer(kh)}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left',
                                  marginBottom: 4, padding: '6px 10px',
                                  background: '#fff', border: '1px solid #bfdbfe',
                                  borderRadius: 4, cursor: 'pointer', fontSize: 13,
                                }}
                              >
                                <strong>{kh.full_name}</strong>
                                <span style={{ color: '#6b7280' }}> · {kh.customer_code}</span>
                                <span style={{ color: '#16a34a', fontSize: 11, marginLeft: 6 }}>
                                  🏆 {kh.loyalty_points.toLocaleString('vi-VN')} điểm
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : showCreateCust ? (
                          <div style={{
                            background: '#fef3c7', border: '1px solid #fcd34d',
                            borderRadius: 6, padding: 10,
                          }}>
                            <div style={{ fontSize: 12, color: '#92400e', marginBottom: 8, fontWeight: 600 }}>
                              ➕ Tạo KH mới với SĐT {phoneSearch}
                            </div>
                            <input
                              className="form-control"
                              placeholder="Họ và tên *"
                              value={newCustName}
                              onChange={e => setNewCustName(e.target.value)}
                              style={{ marginBottom: 6 }}
                            />
                            <input
                              className="form-control"
                              placeholder="Địa chỉ * (cần để xuất hóa đơn)"
                              value={newCustAddress}
                              onChange={e => setNewCustAddress(e.target.value)}
                              style={{ marginBottom: 8 }}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button type="button" className="btn btn-sm btn-primary"
                                onClick={submitCreateCustomer}
                                disabled={createCustMut.isPending}>
                                {createCustMut.isPending ? 'Đang tạo...' : '✓ Tạo & chọn'}
                              </button>
                              <button type="button" className="btn btn-sm btn-secondary"
                                onClick={() => setShowCreateCust(false)}>Hủy</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            background: '#fef3c7', border: '1px solid #fcd34d',
                            borderRadius: 6, padding: 8, fontSize: 12, color: '#92400e',
                          }}>
                            ⚠️ Chưa có KH với SĐT này.{' '}
                            <button type="button"
                              onClick={() => { setShowCreateCust(true); setNewCustName(''); setNewCustAddress(''); }}
                              style={{
                                background: 'none', border: 'none', textDecoration: 'underline',
                                color: '#92400e', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0,
                              }}>
                              Tạo KH mới
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {phoneClean.length > 0 && phoneClean.length < 9 && (
                      <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
                        Cần nhập đủ ≥ 9 số để tra
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="Mô tả công việc sửa chữa..."
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={createMut.isPending}>
                {createMut.isPending ? 'Đang tạo...' : '✓ Tạo & sinh QR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal hiển thị QR */}
      {qrTicket && (
        <div className="modal-overlay" onClick={() => setQrTicket(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📱 QR thanh toán — {qrTicket.ticket_code}</span>
              <button className="modal-close" onClick={() => setQrTicket(null)}>×</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              {qrTicket.payment_status === 'paid' ? (
                <div style={{
                  padding: 30, background: '#dcfce7', border: '2px solid #86efac',
                  borderRadius: 12, color: '#15803d', fontSize: 16, fontWeight: 700,
                }}>
                  ✅ Đã thu thành công<br />
                  <div style={{ fontSize: 22, marginTop: 8 }}>{formatCurrency(qrTicket.amount)}</div>
                  {qrTicket.paid_at && (
                    <div style={{ fontSize: 12, fontWeight: 400, marginTop: 6 }}>
                      {formatDateTime(qrTicket.paid_at)}
                    </div>
                  )}
                </div>
              ) : (() => {
                const url = getQRUrl(qrTicket);
                if (!url) {
                  return (
                    <div style={{ padding: 20, color: '#dc2626', fontSize: 13 }}>
                      ⚠️ Chưa cấu hình tài khoản ngân hàng SEPay.<br />
                      Vào Cấu hình → Thanh toán & SEPay
                    </div>
                  );
                }
                return (
                  <>
                    <img src={url} alt="QR SEPay" width={260} height={260}
                      style={{ borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 12 }} />

                    {/* Thông tin chuyển khoản — KH có thể nhập tay nếu không quét được */}
                    <div style={{
                      background: '#fff', border: '1px solid #e5e7eb',
                      borderRadius: 8, padding: '12px 14px', textAlign: 'left', fontSize: 13,
                      marginBottom: 10,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                        🏦 Thông tin chuyển khoản
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '4px 10px' }}>
                        <span style={{ color: '#6b7280' }}>Ngân hàng:</span>
                        <strong>{paySettings?.bank_name || paySettings?.bank_code || '—'}</strong>

                        <span style={{ color: '#6b7280' }}>Số tài khoản:</span>
                        <strong className="font-mono" style={{ fontSize: 14, color: '#0369a1' }}>
                          {paySettings?.bank_account || '—'}
                        </strong>

                        {paySettings?.bank_account_name && (
                          <>
                            <span style={{ color: '#6b7280' }}>Chủ TK:</span>
                            <strong style={{ textTransform: 'uppercase' }}>{paySettings.bank_account_name}</strong>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Số tiền + nội dung đối chiếu */}
                    <div style={{
                      background: '#f0f9ff', border: '1px solid #bae6fd',
                      borderRadius: 8, padding: '12px 14px', textAlign: 'left', fontSize: 13,
                    }}>
                      <div style={{ marginBottom: 6 }}>
                        <strong>Số tiền:</strong>{' '}
                        <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 16 }}>
                          {formatCurrency(qrTicket.amount)}
                        </span>
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <strong>Nội dung CK:</strong>
                        <span className="font-mono" style={{
                          display: 'inline-block', marginLeft: 6,
                          padding: '2px 8px', background: '#fff', borderRadius: 4,
                          fontSize: 14, color: '#0369a1', fontWeight: 700,
                          border: '1px dashed #0369a1',
                        }}>
                          {qrTicket.ticket_code}
                        </span>
                      </div>
                      {qrTicket.dms_code && (
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#6b7280' }}>
                          Lệnh DMS tham chiếu: <span className="font-mono">{qrTicket.dms_code}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
                        ⏳ Khách quét QR → SEPay tự đối chiếu theo nội dung CK → phiếu chuyển "Đã thu"
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="modal-footer">
              {qrTicket.payment_status === 'pending' && (
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (confirm(`Hủy phiếu ${qrTicket.ticket_code}?`)) cancelMut.mutate(qrTicket.id);
                  }}
                  disabled={cancelMut.isPending}
                >
                  ❌ Hủy phiếu
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setQrTicket(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Modal Xem chi tiết phiếu DV ════ */}
      {viewTicket && (
        <div className="modal-overlay" onClick={() => setViewTicket(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🧾 Phiếu DV <span className="font-mono text-primary">{viewTicket.ticket_code}</span>
              </span>
              <button className="modal-close" onClick={() => setViewTicket(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10, columnGap: 12, fontSize: 14 }}>
                <div className="text-muted">Trạng thái:</div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                    fontSize: 12, fontWeight: 600,
                    background: STATUS_BADGE[viewTicket.payment_status].bg,
                    color:      STATUS_BADGE[viewTicket.payment_status].color,
                  }}>{STATUS_BADGE[viewTicket.payment_status].label}</span>
                </div>

                <div className="text-muted">Mã DMS:</div>
                <div className="font-mono">{viewTicket.dms_code || '—'}</div>

                <div className="text-muted">Số tiền:</div>
                <div className="fw-600" style={{ fontSize: 16, color: '#0369a1' }}>
                  {formatCurrency(viewTicket.amount)}
                </div>

                <div className="text-muted">Phương thức:</div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                    fontSize: 12, fontWeight: 600,
                    background: viewTicket.payment_method === 'cash' ? '#dcfce7' : '#dbeafe',
                    color:      viewTicket.payment_method === 'cash' ? '#15803d' : '#1d4ed8',
                  }}>
                    {viewTicket.payment_method === 'cash' ? '💵 Tiền mặt' : '📱 QR SEPay'}
                  </span>
                </div>

                <div className="text-muted">Khách hàng:</div>
                <div>
                  {viewTicket.customer_name ?? viewTicket.customers?.full_name ?? '—'}
                  {(viewTicket.customer_phone ?? viewTicket.customers?.phone) && (
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      · {viewTicket.customer_phone ?? viewTicket.customers?.phone}
                    </span>
                  )}
                </div>

                {viewTicket.customers && (<>
                  <div className="text-muted">Điểm tích lũy:</div>
                  <div>{viewTicket.customers.loyalty_points ?? 0}</div>
                </>)}

                {viewTicket.sepay_transaction_id && (<>
                  <div className="text-muted">Mã giao dịch SEPay:</div>
                  <div className="font-mono" style={{ fontSize: 12 }}>{viewTicket.sepay_transaction_id}</div>
                </>)}

                {viewTicket.finance_transaction_id && (<>
                  <div className="text-muted">Mã ghi sổ:</div>
                  <div className="font-mono" style={{ fontSize: 12 }}>{viewTicket.finance_transaction_id}</div>
                </>)}

                <div className="text-muted">Người tạo:</div>
                <div>{viewTicket.users?.full_name ?? '—'}</div>

                <div className="text-muted">Tạo lúc:</div>
                <div>{formatDateTime(viewTicket.created_at)}</div>

                {viewTicket.paid_at && (<>
                  <div className="text-muted">Đã thu lúc:</div>
                  <div style={{ color: '#15803d', fontWeight: 600 }}>{formatDateTime(viewTicket.paid_at)}</div>
                </>)}

                {viewTicket.notes && (<>
                  <div className="text-muted">Ghi chú:</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{viewTicket.notes}</div>
                </>)}
              </div>
            </div>
            <div className="modal-footer">
              {viewTicket.payment_status === 'pending' && viewTicket.payment_method === 'qr_sepay' && (
                <button className="btn btn-primary"
                  onClick={() => { setQrTicket(viewTicket); setViewTicket(null); }}>
                  📱 Mở QR
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setViewTicket(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
