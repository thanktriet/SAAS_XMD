// Trang Đơn bán phụ kiện rời — QR SEPay / Tiền mặt
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatCurrency, formatDateTime } from '../utils/helpers';
import { buildSePayQRUrl } from '../types/accounting';
import { useAuthStore } from '../store/authStore';
import BatterySerialInput, { type BatteryAssignmentType } from '../components/BatterySerialInput';
import type { PaymentSettings } from '../types';
import toast from 'react-hot-toast';

interface AccessoryItem {
  id:           string;
  code:         string;
  name:         string;
  unit:         string;
  qty_in_stock: number;
  price_sell:   number;
  category?:    string;
  is_active:    boolean;
}

interface OrderItem {
  id?:          string;
  accessory_id: string;
  quantity:     number;
  unit_price:   number;
  line_total:   number;
  accessories?: { name: string; code: string; unit: string };
}

interface AccessoryOrder {
  id:                     string;
  order_code:             string;
  customer_id:            string | null;
  customer_name:          string | null;
  customer_phone:         string | null;
  subtotal:               number;
  total_amount:           number;
  payment_method:         'qr_sepay' | 'cash';
  payment_status:         'pending' | 'paid' | 'cancelled';
  paid_at:                string | null;
  notes:                  string | null;
  created_at:             string;
  users?:                 { full_name: string } | null;
  customers?:             { full_name: string; phone: string; loyalty_points: number } | null;
  accessory_order_items?: OrderItem[];
}

interface CustomerLookup {
  id:             string;
  customer_code:  string;
  full_name:      string;
  phone:          string;
  loyalty_points: number;
}

interface CartItem {
  accessory:       AccessoryItem;
  quantity:        number;
  serial_numbers:  string[];
  assignment_type: BatteryAssignmentType;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  pending:   { label: '⏳ Chờ thanh toán', bg: '#fef3c7', color: '#92400e' },
  paid:      { label: '✅ Đã thu',          bg: '#dcfce7', color: '#15803d' },
  cancelled: { label: '❌ Đã hủy',           bg: '#fee2e2', color: '#991b1b' },
};

export default function AccessoryOrdersPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canConfirmCash = ['admin', 'manager', 'accountant'].includes(user?.role ?? '');

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [qrOrder, setQrOrder]           = useState<AccessoryOrder | null>(null);
  const [viewOrder, setViewOrder]       = useState<AccessoryOrder | null>(null);

  // Form
  const [paymentMethod, setPaymentMethod] = useState<'qr_sepay' | 'cash'>('qr_sepay');
  const [formNotes, setFormNotes]         = useState('');
  const [cart, setCart]                   = useState<CartItem[]>([]);
  const [accSearch, setAccSearch]         = useState('');

  // KH lookup (giống ServiceTicketsPage)
  const [phoneSearch, setPhoneSearch]   = useState('');
  const [chosenCustomer, setChosenCustomer] = useState<CustomerLookup | null>(null);
  const [showCreateCust, setShowCreateCust] = useState(false);
  const [newCustName, setNewCustName]   = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');

  const phoneClean = phoneSearch.replace(/\D/g, '');

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data: paySettings } = useQuery<PaymentSettings>({
    queryKey: ['payment-settings'],
    queryFn:  () => api.get('/settings/payment').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery<{ data: AccessoryOrder[]; total: number }>({
    queryKey: ['accessory-orders', statusFilter, search],
    queryFn:  () => api.get('/accessory-orders', {
      params: { status: statusFilter || undefined, search: search || undefined },
    }).then(r => r.data),
    refetchInterval: 4_000,
  });
  const orders = data?.data ?? [];

  // Phụ kiện có sẵn (active)
  const { data: accData } = useQuery<{ data: AccessoryItem[]; total: number }>({
    queryKey: ['accessories-active'],
    queryFn:  () => api.get('/inventory/accessories', {
      params: { is_active: 'true', limit: 200 },
    }).then(r => r.data),
    enabled: showNewModal,
    staleTime: 60_000,
  });
  const accessories = (accData?.data ?? []).filter(a =>
    !accSearch ||
    a.name.toLowerCase().includes(accSearch.toLowerCase()) ||
    a.code.toLowerCase().includes(accSearch.toLowerCase())
  );

  // KH lookup
  const { data: lookupData } = useQuery<{ data: CustomerLookup[] }>({
    queryKey: ['acc-order-customer-lookup', phoneClean],
    queryFn:  () => api.get('/customers', {
      params: { phone_exact: phoneClean, limit: 5 },
    }).then(r => r.data),
    enabled: phoneClean.length >= 9 && !chosenCustomer && showNewModal,
    staleTime: 5_000,
  });
  const matchedCustomers = lookupData?.data ?? [];

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body: any) => api.post('/accessory-orders', body).then(r => r.data),
    onSuccess: (newOrder) => {
      toast.success(`✅ Đã tạo đơn ${newOrder.order_code}`);
      qc.invalidateQueries({ queryKey: ['accessory-orders'] });
      setShowNewModal(false);
      resetForm();
      if (newOrder.payment_method === 'qr_sepay') {
        setQrOrder(newOrder);
      } else {
        toast('💵 Đơn chờ kế toán xác nhận thu tiền mặt', { icon: '⏳' });
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo đơn'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/accessory-orders/${id}/cancel`).then(r => r.data),
    onSuccess: () => {
      toast.success('Đã hủy đơn');
      qc.invalidateQueries({ queryKey: ['accessory-orders'] });
      setQrOrder(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi hủy đơn'),
  });

  const confirmCashMut = useMutation({
    mutationFn: (id: string) => api.patch(`/accessory-orders/${id}/confirm-cash`).then(r => r.data),
    onSuccess: (updated) => {
      toast.success(`✅ Đã thu tiền mặt đơn ${updated.order_code}`);
      qc.invalidateQueries({ queryKey: ['accessory-orders'] });
      setQrOrder(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi xác nhận'),
  });

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

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function resetForm() {
    setPaymentMethod('qr_sepay');
    setFormNotes('');
    setCart([]);
    setAccSearch('');
    setPhoneSearch(''); setChosenCustomer(null);
    setShowCreateCust(false); setNewCustName(''); setNewCustAddress('');
  }

  function addToCart(acc: AccessoryItem) {
    if (acc.qty_in_stock <= 0) {
      toast.error(`"${acc.name}" hết hàng`);
      return;
    }
    setCart(prev => {
      const idx = prev.findIndex(c => c.accessory.id === acc.id);
      if (idx >= 0) {
        const newQty = prev[idx].quantity + 1;
        if (newQty > acc.qty_in_stock) {
          toast.error(`"${acc.name}" chỉ còn ${acc.qty_in_stock}`);
          return prev;
        }
        return prev.map((c, i) =>
          i === idx
            ? { ...c, quantity: newQty, serial_numbers: [...c.serial_numbers, ''] }
            : c
        );
      }
      const isBattery = acc.category === 'battery';
      return [...prev, {
        accessory:       acc,
        quantity:        1,
        serial_numbers:  isBattery ? [''] : [],
        assignment_type: 'purchase',
      }];
    });
  }

  function setItemSerials(accId: string, serials: string[]) {
    setCart(prev => prev.map(c =>
      c.accessory.id === accId ? { ...c, serial_numbers: serials } : c
    ));
  }
  function setItemAssignmentType(accId: string, t: BatteryAssignmentType) {
    setCart(prev => prev.map(c =>
      c.accessory.id === accId ? { ...c, assignment_type: t } : c
    ));
  }

  function changeQty(accId: string, delta: number) {
    setCart(prev => prev
      .map(c => {
        if (c.accessory.id !== accId) return c;
        const newQty = c.quantity + delta;
        if (newQty <= 0) return null;
        if (newQty > c.accessory.qty_in_stock) {
          toast.error(`"${c.accessory.name}" chỉ còn ${c.accessory.qty_in_stock}`);
          return c;
        }
        // Đồng bộ serial_numbers theo số lượng (chỉ pin)
        const isBattery = c.accessory.category === 'battery';
        let serials = c.serial_numbers;
        if (isBattery) {
          serials = [...c.serial_numbers];
          while (serials.length < newQty) serials.push('');
          while (serials.length > newQty) serials.pop();
        }
        return { ...c, quantity: newQty, serial_numbers: serials };
      })
      .filter(Boolean) as CartItem[]
    );
  }

  function removeFromCart(accId: string) {
    setCart(prev => prev.filter(c => c.accessory.id !== accId));
  }

  // Tổng tiền — pin thuê không tính
  const cartTotal = cart.reduce((s, c) => {
    const isBattery = c.accessory.category === 'battery';
    if (isBattery && c.assignment_type === 'rent') return s;
    return s + c.accessory.price_sell * c.quantity;
  }, 0);

  function submitCreate() {
    if (!chosenCustomer) { toast.error('Phải chọn hoặc tạo khách hàng'); return; }
    if (cart.length === 0) { toast.error('Phải thêm ít nhất 1 phụ kiện'); return; }

    // Validate pin: phải nhập đủ serial
    for (const c of cart) {
      if (c.accessory.category !== 'battery') continue;
      const filled = c.serial_numbers.filter(s => s.trim()).length;
      if (filled !== c.quantity) {
        toast.error(`Pin "${c.accessory.name}": cần ${c.quantity} serial, đã nhập ${filled}`);
        return;
      }
    }

    createMut.mutate({
      customer_id:    chosenCustomer.id,
      payment_method: paymentMethod,
      notes:          formNotes.trim() || undefined,
      items: cart.map(c => ({
        accessory_id:    c.accessory.id,
        quantity:        c.quantity,
        unit_price:      c.accessory.price_sell,
        serial_numbers:  c.accessory.category === 'battery' ? c.serial_numbers : undefined,
        assignment_type: c.accessory.category === 'battery' ? c.assignment_type : undefined,
      })),
    });
  }

  function submitCreateCustomer() {
    if (!newCustName.trim())   { toast.error('Nhập họ tên KH'); return; }
    if (!phoneClean)           { toast.error('Nhập SĐT'); return; }
    if (!newCustAddress.trim()){ toast.error('Nhập địa chỉ'); return; }
    createCustMut.mutate({
      full_name: newCustName.trim(),
      phone:     phoneSearch.trim(),
      address:   newCustAddress.trim(),
    });
  }

  function getQRUrl(o: AccessoryOrder): string | null {
    if (!paySettings?.bank_code || !paySettings?.bank_account) return null;
    return buildSePayQRUrl({
      bank:           paySettings.bank_code,
      account_number: paySettings.bank_account,
      amount:         Number(o.total_amount),
      description:    o.order_code,
      template:       'compact2',
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🎒 Đơn bán phụ kiện</span>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          + Tạo đơn mới
        </button>
      </div>

      <div className="page-content">
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              className="form-control"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Tìm theo mã đơn / tên KH / SĐT"
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

        <div className="card">
          <div className="card-header">
            <span className="card-title">Danh sách đơn ({orders.length})</span>
          </div>
          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : orders.length === 0 ? (
              <div className="empty-state"><p>Chưa có đơn bán phụ kiện nào</p></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Mã đơn</th>
                    <th>Khách hàng</th>
                    <th>Phụ kiện</th>
                    <th style={{ textAlign: 'right' }}>Tổng tiền</th>
                    <th>PT</th>
                    <th>Trạng thái</th>
                    <th className="hide-mobile">Thời gian</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => {
                    const st    = STATUS_BADGE[o.payment_status];
                    const items = o.accessory_order_items ?? [];
                    const first = items[0];
                    return (
                      <tr key={o.id}>
                        <td><span className="font-mono text-primary">{o.order_code}</span></td>
                        <td>
                          {o.customer_name || '—'}
                          {o.customer_phone && (
                            <><br /><span className="text-muted" style={{ fontSize: 12 }}>{o.customer_phone}</span></>
                          )}
                        </td>
                        <td>
                          {first
                            ? <>
                                <span style={{ fontSize: 13 }}>{first.accessories?.name}</span>
                                {items.length > 1 && (
                                  <span className="text-muted" style={{ fontSize: 11 }}> +{items.length - 1}</span>
                                )}
                              </>
                            : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(o.total_amount)}</td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: o.payment_method === 'cash' ? '#dcfce7' : '#dbeafe',
                            color:      o.payment_method === 'cash' ? '#15803d' : '#1d4ed8',
                          }}>
                            {o.payment_method === 'cash' ? '💵 Tiền mặt' : '📱 QR'}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: st.bg, color: st.color,
                          }}>{st.label}</span>
                        </td>
                        <td className="text-muted hide-mobile" style={{ fontSize: 12 }}>
                          {o.payment_status === 'paid' && o.paid_at
                            ? `Thu: ${formatDateTime(o.paid_at)}`
                            : formatDateTime(o.created_at)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm btn-secondary"
                              onClick={() => setViewOrder(o)} title="Xem chi tiết">
                              👁 Xem
                            </button>
                            {o.payment_status === 'pending' && o.payment_method === 'qr_sepay' && (
                              <button className="btn btn-sm btn-primary" onClick={() => setQrOrder(o)}>
                                📱 Mở QR
                              </button>
                            )}
                            {o.payment_status === 'pending' && o.payment_method === 'cash' && canConfirmCash && (
                              <button
                                className="btn btn-sm"
                                style={{ background: '#16a34a', color: '#fff' }}
                                onClick={() => {
                                  if (confirm(`Xác nhận đã thu ${formatCurrency(o.total_amount)} tiền mặt cho đơn ${o.order_code}?`)) {
                                    confirmCashMut.mutate(o.id);
                                  }
                                }}
                                disabled={confirmCashMut.isPending}
                              >
                                💵 Thu tiền mặt
                              </button>
                            )}
                            {o.payment_status === 'pending' && o.payment_method === 'cash' && !canConfirmCash && (
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

      {/* ════ Modal tạo đơn ════ */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{ maxWidth: 800 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">+ Tạo đơn bán phụ kiện</span>
              <button className="modal-close" onClick={() => setShowNewModal(false)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

              {/* CỘT TRÁI: KH + thanh toán + ghi chú */}
              <div>
                {/* KH */}
                <div className="form-group">
                  <label className="form-label">Khách hàng <span className="required">*</span></label>
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
                          📞 {chosenCustomer.phone} · 🏆 {chosenCustomer.loyalty_points.toLocaleString('vi-VN')} điểm
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#dc2626' }}
                        onClick={() => { setChosenCustomer(null); setPhoneSearch(''); setShowCreateCust(false); }}
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
                      {phoneClean.length >= 9 && (
                        <div style={{ marginTop: 8 }}>
                          {matchedCustomers.length > 0 ? (
                            <div style={{
                              background: '#eff6ff', border: '1px solid #bfdbfe',
                              borderRadius: 6, padding: 8,
                            }}>
                              <div style={{ fontSize: 11, color: '#1d4ed8', marginBottom: 6, fontWeight: 600 }}>
                                ✅ Tìm thấy {matchedCustomers.length} KH:
                              </div>
                              {matchedCustomers.map(kh => (
                                <button
                                  key={kh.id} type="button"
                                  onClick={() => setChosenCustomer(kh)}
                                  style={{
                                    display: 'block', width: '100%', textAlign: 'left',
                                    marginBottom: 4, padding: '6px 10px',
                                    background: '#fff', border: '1px solid #bfdbfe',
                                    borderRadius: 4, cursor: 'pointer', fontSize: 13,
                                  }}
                                >
                                  <strong>{kh.full_name}</strong>
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
                              <input className="form-control" placeholder="Họ và tên *"
                                value={newCustName} onChange={e => setNewCustName(e.target.value)}
                                style={{ marginBottom: 6 }} />
                              <input className="form-control" placeholder="Địa chỉ *"
                                value={newCustAddress} onChange={e => setNewCustAddress(e.target.value)}
                                style={{ marginBottom: 8 }} />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button type="button" className="btn btn-sm btn-primary"
                                  onClick={submitCreateCustomer} disabled={createCustMut.isPending}>
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
                                }}>Tạo KH mới</button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Phương thức thanh toán */}
                <div className="form-group">
                  <label className="form-label">Phương thức thanh toán</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button type="button" onClick={() => setPaymentMethod('qr_sepay')}
                      style={{
                        padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        border: `2px solid ${paymentMethod === 'qr_sepay' ? '#2563eb' : '#e5e7eb'}`,
                        background: paymentMethod === 'qr_sepay' ? '#eff6ff' : '#fff',
                        color: paymentMethod === 'qr_sepay' ? '#2563eb' : '#6b7280',
                      }}>📱 QR SEPay</button>
                    <button type="button" onClick={() => setPaymentMethod('cash')}
                      style={{
                        padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        border: `2px solid ${paymentMethod === 'cash' ? '#16a34a' : '#e5e7eb'}`,
                        background: paymentMethod === 'cash' ? '#f0fdf4' : '#fff',
                        color: paymentMethod === 'cash' ? '#16a34a' : '#6b7280',
                      }}>💵 Tiền mặt</button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Ghi chú</label>
                  <textarea className="form-control" rows={2}
                    value={formNotes} onChange={e => setFormNotes(e.target.value)} />
                </div>

                {/* Tóm tắt giỏ */}
                <div style={{
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  borderRadius: 8, padding: 10, marginTop: 10,
                }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                    Đã chọn {cart.length} phụ kiện
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#dc2626' }}>
                    Tổng: {formatCurrency(cartTotal)}
                  </div>
                </div>
              </div>

              {/* CỘT PHẢI: chọn phụ kiện + giỏ */}
              <div>
                <label className="form-label">Phụ kiện <span className="required">*</span></label>
                <input
                  className="form-control"
                  style={{ marginBottom: 8 }}
                  placeholder="Tìm phụ kiện..."
                  value={accSearch}
                  onChange={e => setAccSearch(e.target.value)}
                />
                <div style={{
                  border: '1px solid #e5e7eb', borderRadius: 6,
                  maxHeight: 180, overflowY: 'auto', marginBottom: 12,
                }}>
                  {accessories.length === 0 ? (
                    <div style={{ padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                      Không có phụ kiện
                    </div>
                  ) : accessories.slice(0, 50).map(acc => (
                    <button
                      key={acc.id} type="button"
                      onClick={() => addToCart(acc)}
                      disabled={acc.qty_in_stock <= 0}
                      style={{
                        width: '100%', display: 'flex', justifyContent: 'space-between',
                        padding: '8px 12px', borderBottom: '1px solid #f3f4f6',
                        background: '#fff', border: 'none', cursor: acc.qty_in_stock > 0 ? 'pointer' : 'not-allowed',
                        textAlign: 'left', fontSize: 13,
                        opacity: acc.qty_in_stock > 0 ? 1 : 0.5,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{acc.name}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          {acc.code} · Tồn: {acc.qty_in_stock} {acc.unit}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, color: '#2563eb' }}>
                        {formatCurrency(acc.price_sell)}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Giỏ */}
                {cart.length > 0 && (
                  <div style={{
                    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
                  }}>
                    <div style={{ padding: '8px 12px', background: '#f9fafb', fontSize: 12, fontWeight: 600 }}>
                      Giỏ hàng
                    </div>
                    {cart.map(c => {
                      const isBattery = c.accessory.category === 'battery';
                      const isRent    = isBattery && c.assignment_type === 'rent';
                      const lineTotal = isRent ? 0 : c.accessory.price_sell * c.quantity;
                      return (
                        <div key={c.accessory.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px',
                          }}>
                            <div style={{ flex: 1, fontSize: 12 }}>
                              <strong>{isBattery && '🔋 '}{c.accessory.name}</strong>
                              <div style={{ color: '#6b7280' }}>
                                {formatCurrency(c.accessory.price_sell)} × {c.quantity} = {formatCurrency(lineTotal)}
                                {isRent && <span style={{ color: '#6d28d9', fontWeight: 600 }}> (thuê)</span>}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <button type="button" onClick={() => changeQty(c.accessory.id, -1)}
                                style={{ width: 24, height: 24, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>−</button>
                              <span style={{ minWidth: 24, textAlign: 'center', fontSize: 13 }}>{c.quantity}</span>
                              <button type="button" onClick={() => changeQty(c.accessory.id, +1)}
                                style={{ width: 24, height: 24, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>+</button>
                              <button type="button" onClick={() => removeFromCart(c.accessory.id)}
                                style={{ marginLeft: 4, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                            </div>
                          </div>

                          {/* Pin: bắt buộc nhập serial + chọn mua/thuê */}
                          {isBattery && (
                            <div style={{ padding: '0 12px 12px' }}>
                              <BatterySerialInput
                                quantity={c.quantity}
                                serials={c.serial_numbers}
                                assignmentType={c.assignment_type}
                                onChangeSerials={(s) => setItemSerials(c.accessory.id, s)}
                                onChangeType={(t) => setItemAssignmentType(c.accessory.id, t)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={createMut.isPending}>
                {createMut.isPending ? 'Đang tạo...' : '✓ Tạo đơn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Modal QR ════ */}
      {qrOrder && (
        <div className="modal-overlay" onClick={() => setQrOrder(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📱 QR — {qrOrder.order_code}</span>
              <button className="modal-close" onClick={() => setQrOrder(null)}>×</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              {qrOrder.payment_status === 'paid' ? (
                <div style={{
                  padding: 30, background: '#dcfce7', border: '2px solid #86efac',
                  borderRadius: 12, color: '#15803d', fontSize: 16, fontWeight: 700,
                }}>
                  ✅ Đã thu thành công<br />
                  <div style={{ fontSize: 22, marginTop: 8 }}>{formatCurrency(qrOrder.total_amount)}</div>
                </div>
              ) : (() => {
                const url = getQRUrl(qrOrder);
                if (!url) {
                  return <div style={{ padding: 20, color: '#dc2626' }}>⚠️ Chưa cấu hình SEPay</div>;
                }
                return (
                  <>
                    <img src={url} alt="QR" width={260} height={260}
                      style={{ borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 12 }} />
                    <div style={{
                      background: '#fff', border: '1px solid #e5e7eb',
                      borderRadius: 8, padding: '12px 14px', textAlign: 'left', fontSize: 13, marginBottom: 10,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>
                        🏦 THÔNG TIN CHUYỂN KHOẢN
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '4px 10px' }}>
                        <span style={{ color: '#6b7280' }}>Ngân hàng:</span>
                        <strong>{paySettings?.bank_name || paySettings?.bank_code}</strong>
                        <span style={{ color: '#6b7280' }}>STK:</span>
                        <strong className="font-mono" style={{ color: '#0369a1' }}>{paySettings?.bank_account}</strong>
                        {paySettings?.bank_account_name && (<>
                          <span style={{ color: '#6b7280' }}>Chủ TK:</span>
                          <strong style={{ textTransform: 'uppercase' }}>{paySettings.bank_account_name}</strong>
                        </>)}
                      </div>
                    </div>
                    <div style={{
                      background: '#f0f9ff', border: '1px solid #bae6fd',
                      borderRadius: 8, padding: '12px 14px', textAlign: 'left', fontSize: 13,
                    }}>
                      <div style={{ marginBottom: 6 }}>
                        <strong>Số tiền:</strong>{' '}
                        <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 16 }}>
                          {formatCurrency(qrOrder.total_amount)}
                        </span>
                      </div>
                      <div>
                        <strong>Nội dung:</strong>{' '}
                        <span className="font-mono" style={{
                          padding: '2px 8px', background: '#fff', borderRadius: 4,
                          fontSize: 14, color: '#0369a1', fontWeight: 700,
                          border: '1px dashed #0369a1',
                        }}>{qrOrder.order_code}</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="modal-footer">
              {qrOrder.payment_status === 'pending' && (
                <button className="btn btn-danger"
                  onClick={() => {
                    if (confirm(`Hủy đơn ${qrOrder.order_code}?`)) cancelMut.mutate(qrOrder.id);
                  }}
                  disabled={cancelMut.isPending}>❌ Hủy đơn</button>
              )}
              <button className="btn btn-secondary" onClick={() => setQrOrder(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Modal Xem chi tiết đơn phụ kiện ════ */}
      {viewOrder && (
        <div className="modal-overlay" onClick={() => setViewOrder(null)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🛒 Đơn phụ kiện <span className="font-mono text-primary">{viewOrder.order_code}</span>
              </span>
              <button className="modal-close" onClick={() => setViewOrder(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10, columnGap: 12, fontSize: 14, marginBottom: 16 }}>
                <div className="text-muted">Trạng thái:</div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                    fontSize: 12, fontWeight: 600,
                    background: STATUS_BADGE[viewOrder.payment_status].bg,
                    color:      STATUS_BADGE[viewOrder.payment_status].color,
                  }}>{STATUS_BADGE[viewOrder.payment_status].label}</span>
                </div>

                <div className="text-muted">Phương thức:</div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                    fontSize: 12, fontWeight: 600,
                    background: viewOrder.payment_method === 'cash' ? '#dcfce7' : '#dbeafe',
                    color:      viewOrder.payment_method === 'cash' ? '#15803d' : '#1d4ed8',
                  }}>
                    {viewOrder.payment_method === 'cash' ? '💵 Tiền mặt' : '📱 QR SEPay'}
                  </span>
                </div>

                <div className="text-muted">Khách hàng:</div>
                <div>
                  {viewOrder.customer_name ?? viewOrder.customers?.full_name ?? '—'}
                  {(viewOrder.customer_phone ?? viewOrder.customers?.phone) && (
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      · {viewOrder.customer_phone ?? viewOrder.customers?.phone}
                    </span>
                  )}
                </div>

                {viewOrder.customers && (<>
                  <div className="text-muted">Điểm tích lũy:</div>
                  <div>{viewOrder.customers.loyalty_points ?? 0}</div>
                </>)}

                <div className="text-muted">Người tạo:</div>
                <div>{viewOrder.users?.full_name ?? '—'}</div>

                <div className="text-muted">Tạo lúc:</div>
                <div>{formatDateTime(viewOrder.created_at)}</div>

                {viewOrder.paid_at && (<>
                  <div className="text-muted">Đã thu lúc:</div>
                  <div style={{ color: '#15803d', fontWeight: 600 }}>{formatDateTime(viewOrder.paid_at)}</div>
                </>)}

                {viewOrder.notes && (<>
                  <div className="text-muted">Ghi chú:</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{viewOrder.notes}</div>
                </>)}
              </div>

              {/* Bảng items */}
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Danh sách phụ kiện ({viewOrder.accessory_order_items?.length ?? 0})
              </div>
              {(viewOrder.accessory_order_items?.length ?? 0) === 0 ? (
                <div className="text-muted" style={{ fontSize: 13, fontStyle: 'italic' }}>Không có dòng phụ kiện</div>
              ) : (
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên</th>
                      <th style={{ textAlign: 'right' }}>SL</th>
                      <th style={{ textAlign: 'right' }}>Đơn giá</th>
                      <th style={{ textAlign: 'right' }}>Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewOrder.accessory_order_items!.map(it => (
                      <tr key={it.id ?? it.accessory_id}>
                        <td className="font-mono" style={{ fontSize: 12 }}>{it.accessories?.code ?? '—'}</td>
                        <td>{it.accessories?.name ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{it.quantity} {it.accessories?.unit ?? ''}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(it.unit_price)}</td>
                        <td style={{ textAlign: 'right' }} className="fw-600">{formatCurrency(it.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Tạm tính:</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(viewOrder.subtotal)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>Tổng cộng:</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: '#0369a1' }}>
                        {formatCurrency(viewOrder.total_amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <div className="modal-footer">
              {viewOrder.payment_status === 'pending' && viewOrder.payment_method === 'qr_sepay' && (
                <button className="btn btn-primary"
                  onClick={() => { setQrOrder(viewOrder); setViewOrder(null); }}>
                  📱 Mở QR
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setViewOrder(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
