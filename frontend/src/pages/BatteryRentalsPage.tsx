// Trang Pin thuê độc lập — KTV cấp pin thuê + trả pin
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatDateTime } from '../utils/helpers';
import BatterySerialInput from '../components/BatterySerialInput';
import toast from 'react-hot-toast';

interface Assignment {
  id:              string;
  accessory_id:    string;
  serial_number:   string;
  assignment_type: string;
  status:          string;
  assigned_at:     string;
  returned_at:     string | null;
  vehicle_vin:     string | null;
  accessories?:    { name: string; code: string };
}

interface Rental {
  id:             string;
  rental_code:    string;
  customer_id:    string;
  customer_name:  string | null;
  customer_phone: string | null;
  vehicle_vin:    string | null;
  status:         'active' | 'completed' | 'cancelled';
  notes:          string | null;
  created_at:     string;
  users?:         { full_name: string } | null;
  customers?:     { full_name: string; phone: string };
  battery_assignments?: Assignment[];
}

interface CustomerLookup {
  id:             string;
  customer_code:  string;
  full_name:      string;
  phone:          string;
  loyalty_points: number;
}

interface BatteryAcc {
  id:           string;
  code:         string;
  name:         string;
  qty_in_stock: number;
  category?:    string;
}

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: '🔋 Đang thuê',  bg: '#fef3c7', color: '#92400e' },
  completed: { label: '✅ Đã trả',      bg: '#dcfce7', color: '#15803d' },
  cancelled: { label: '❌ Đã hủy',      bg: '#fee2e2', color: '#991b1b' },
};

export default function BatteryRentalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'list' | 'return'>('list');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);

  // ── Form tạo phiếu thuê
  const [vehicleVin, setVehicleVin] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [pinId, setPinId] = useState('');
  const [pinQty, setPinQty] = useState(1);
  const [pinSerials, setPinSerials] = useState<string[]>(['']);

  // KH lookup
  const [phoneSearch, setPhoneSearch] = useState('');
  const [chosenCustomer, setChosenCustomer] = useState<CustomerLookup | null>(null);
  const [showCreateCust, setShowCreateCust] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const phoneClean = phoneSearch.replace(/\D/g, '');

  // ── Trả pin theo serial
  const [returnSerial, setReturnSerial] = useState('');

  // ── Queries
  const { data, isLoading } = useQuery<{ data: Rental[]; total: number }>({
    queryKey: ['battery-rentals', statusFilter, search],
    queryFn: () => api.get('/battery-rentals', {
      params: { status: statusFilter || undefined, search: search || undefined },
    }).then(r => r.data),
  });
  const rentals = data?.data ?? [];

  // Pin trong kho
  const { data: pinData } = useQuery<{ data: BatteryAcc[] }>({
    queryKey: ['battery-accessories'],
    queryFn:  () => api.get('/inventory/accessories', {
      params: { category: 'battery', is_active: 'true', limit: 100 },
    }).then(r => r.data),
    enabled: showNewModal,
  });
  const dsPin = pinData?.data ?? [];
  const pinChon = dsPin.find(p => p.id === pinId);

  // KH lookup
  const { data: lookupData } = useQuery<{ data: CustomerLookup[] }>({
    queryKey: ['rental-customer-lookup', phoneClean],
    queryFn:  () => api.get('/customers', {
      params: { phone_exact: phoneClean, limit: 5 },
    }).then(r => r.data),
    enabled: phoneClean.length >= 9 && !chosenCustomer && showNewModal,
    staleTime: 5_000,
  });
  const matchedCustomers = lookupData?.data ?? [];

  // ── Mutations
  const createMut = useMutation({
    mutationFn: (body: any) => api.post('/battery-rentals', body).then(r => r.data),
    onSuccess: (newRental) => {
      toast.success(`✅ Đã tạo phiếu ${newRental.rental_code}`);
      qc.invalidateQueries({ queryKey: ['battery-rentals'] });
      setShowNewModal(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo phiếu'),
  });

  const returnMut = useMutation({
    mutationFn: (body: { serial_number: string; reason?: string }) =>
      api.post('/battery-rentals/return-by-serial', body).then(r => r.data),
    onSuccess: () => {
      toast.success('✅ Đã trả pin về kho');
      qc.invalidateQueries({ queryKey: ['battery-rentals'] });
      qc.invalidateQueries({ queryKey: ['battery-accessories'] });
      setReturnSerial('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi trả pin'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/battery-rentals/${id}/cancel`).then(r => r.data),
    onSuccess: () => {
      toast.success('Đã hủy phiếu');
      qc.invalidateQueries({ queryKey: ['battery-rentals'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi hủy'),
  });

  const createCustMut = useMutation({
    mutationFn: (body: any) => api.post('/customers', body).then(r => r.data),
    onSuccess: (kh) => {
      toast.success(`Đã tạo KH ${kh.full_name}`);
      setChosenCustomer({
        id: kh.id, customer_code: kh.customer_code,
        full_name: kh.full_name, phone: kh.phone,
        loyalty_points: kh.loyalty_points || 0,
      });
      setShowCreateCust(false);
      setNewCustName(''); setNewCustAddress('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo KH'),
  });

  function resetForm() {
    setVehicleVin(''); setFormNotes('');
    setPinId(''); setPinQty(1); setPinSerials(['']);
    setPhoneSearch(''); setChosenCustomer(null);
    setShowCreateCust(false); setNewCustName(''); setNewCustAddress('');
  }

  function submitCreate() {
    if (!chosenCustomer) { toast.error('Phải chọn KH'); return; }
    if (!pinChon) { toast.error('Chọn loại pin'); return; }
    if (pinQty <= 0) { toast.error('Số lượng phải > 0'); return; }
    const filled = pinSerials.filter(s => s.trim()).length;
    if (filled !== pinQty) {
      toast.error(`Cần ${pinQty} serial, đã nhập ${filled}`);
      return;
    }

    createMut.mutate({
      customer_id:  chosenCustomer.id,
      vehicle_vin:  vehicleVin.trim() || undefined,
      notes:        formNotes.trim() || undefined,
      items: [{
        accessory_id:    pinChon.id,
        quantity:        pinQty,
        unit_price:      0,
        serial_numbers:  pinSerials,
        assignment_type: 'rent',
      }],
    });
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🔋 Pin thuê</span>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          + Tạo phiếu thuê pin
        </button>
      </div>

      <div className="page-content">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
          <button
            onClick={() => setTab('list')}
            style={{
              padding: '10px 20px', border: 'none',
              background: 'transparent', cursor: 'pointer', fontSize: 14,
              fontWeight: tab === 'list' ? 700 : 500,
              color: tab === 'list' ? '#2563eb' : '#6b7280',
              borderBottom: tab === 'list' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            📋 Danh sách phiếu
          </button>
          <button
            onClick={() => setTab('return')}
            style={{
              padding: '10px 20px', border: 'none',
              background: 'transparent', cursor: 'pointer', fontSize: 14,
              fontWeight: tab === 'return' ? 700 : 500,
              color: tab === 'return' ? '#2563eb' : '#6b7280',
              borderBottom: tab === 'return' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            ↩️ Trả pin theo serial
          </button>
        </div>

        {tab === 'list' && (
          <>
            <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <input
                  className="form-control"
                  style={{ flex: 1, minWidth: 200 }}
                  placeholder="Tìm theo mã phiếu / SĐT KH / VIN xe"
                  value={search} onChange={e => setSearch(e.target.value)}
                />
                <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">Tất cả trạng thái</option>
                  <option value="active">Đang thuê</option>
                  <option value="completed">Đã trả</option>
                  <option value="cancelled">Đã hủy</option>
                </select>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Phiếu thuê pin ({rentals.length})</span>
              </div>
              <div className="table-wrap">
                {isLoading ? (
                  <div className="loading-center"><div className="spinner" /></div>
                ) : rentals.length === 0 ? (
                  <div className="empty-state"><p>Chưa có phiếu thuê pin nào</p></div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Mã phiếu</th>
                        <th>Khách hàng</th>
                        <th>VIN xe</th>
                        <th>Pin</th>
                        <th>Trạng thái</th>
                        <th className="hide-mobile">Ngày tạo</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rentals.map(r => {
                        const st = STATUS[r.status];
                        const assigned = (r.battery_assignments ?? []).filter(a => a.status === 'assigned').length;
                        const total    = (r.battery_assignments ?? []).length;
                        return (
                          <tr key={r.id}>
                            <td><span className="font-mono text-primary">{r.rental_code}</span></td>
                            <td>
                              {r.customer_name || '—'}
                              {r.customer_phone && <><br /><span className="text-muted" style={{ fontSize: 12 }}>{r.customer_phone}</span></>}
                            </td>
                            <td><span className="font-mono" style={{ fontSize: 12 }}>{r.vehicle_vin || '—'}</span></td>
                            <td>
                              {assigned}/{total} pin đang thuê
                            </td>
                            <td>
                              <span style={{
                                display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                                fontSize: 11, fontWeight: 600,
                                background: st.bg, color: st.color,
                              }}>{st.label}</span>
                            </td>
                            <td className="text-muted hide-mobile" style={{ fontSize: 12 }}>{formatDateTime(r.created_at)}</td>
                            <td>
                              {r.status === 'active' && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => {
                                    if (confirm(`Hủy phiếu ${r.rental_code}? Pin sẽ trả về kho.`)) {
                                      cancelMut.mutate(r.id);
                                    }
                                  }}
                                  disabled={cancelMut.isPending}
                                >❌ Hủy</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

        {tab === 'return' && (
          <div className="card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16, color: '#374151' }}>↩️ Trả pin về kho</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Nhập / quét serial pin → hệ thống tự tìm phiếu, đánh dấu đã trả, và tăng tồn kho 1 pin.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                className="form-control"
                style={{ flex: 1, fontFamily: 'monospace' }}
                placeholder="BAT00000010AA2102771260425N01119"
                value={returnSerial}
                onChange={e => setReturnSerial(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={() => {
                  const sn = returnSerial.trim();
                  if (!sn) { toast.error('Nhập serial pin'); return; }
                  returnMut.mutate({ serial_number: sn });
                }}
                disabled={returnMut.isPending}
              >
                {returnMut.isPending ? 'Đang xử lý...' : '✓ Trả pin'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal tạo phiếu */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">+ Tạo phiếu thuê pin</span>
              <button className="modal-close" onClick={() => setShowNewModal(false)}>×</button>
            </div>
            <div className="modal-body">
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
                      <div style={{ fontSize: 12, color: '#15803d' }}>📞 {chosenCustomer.phone}</div>
                    </div>
                    <button type="button"
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
                          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: 8 }}>
                            {matchedCustomers.map(kh => (
                              <button key={kh.id} type="button" onClick={() => setChosenCustomer(kh)}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left',
                                  marginBottom: 4, padding: '6px 10px',
                                  background: '#fff', border: '1px solid #bfdbfe',
                                  borderRadius: 4, cursor: 'pointer', fontSize: 13,
                                }}>
                                <strong>{kh.full_name}</strong> · {kh.customer_code}
                              </button>
                            ))}
                          </div>
                        ) : showCreateCust ? (
                          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10 }}>
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
                                onClick={() => {
                                  if (!newCustName.trim()) { toast.error('Nhập họ tên'); return; }
                                  if (!newCustAddress.trim()) { toast.error('Nhập địa chỉ'); return; }
                                  createCustMut.mutate({
                                    full_name: newCustName.trim(),
                                    phone: phoneSearch.trim(),
                                    address: newCustAddress.trim(),
                                  });
                                }}
                                disabled={createCustMut.isPending}>
                                {createCustMut.isPending ? 'Đang tạo...' : '✓ Tạo & chọn'}
                              </button>
                              <button type="button" className="btn btn-sm btn-secondary"
                                onClick={() => setShowCreateCust(false)}>Hủy</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 8, fontSize: 12, color: '#92400e' }}>
                            ⚠️ Chưa có KH với SĐT này.{' '}
                            <button type="button"
                              onClick={() => { setShowCreateCust(true); setNewCustName(''); setNewCustAddress(''); }}
                              style={{ background: 'none', border: 'none', textDecoration: 'underline', color: '#92400e', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>
                              Tạo KH mới
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* VIN */}
              <div className="form-group">
                <label className="form-label">VIN xe gắn pin</label>
                <input className="form-control" placeholder="(không bắt buộc)"
                  value={vehicleVin} onChange={e => setVehicleVin(e.target.value)} />
              </div>

              {/* Pin */}
              <div className="form-group">
                <label className="form-label">Loại pin <span className="required">*</span></label>
                <select className="form-control"
                  value={pinId} onChange={e => setPinId(e.target.value)}>
                  <option value="">— Chọn loại pin —</option>
                  {dsPin.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) · Tồn: {p.qty_in_stock}
                    </option>
                  ))}
                </select>
                {dsPin.length === 0 && (
                  <small style={{ fontSize: 11, color: '#dc2626' }}>
                    Chưa có phụ kiện loại "Pin xe" trong kho. Thêm tại trang Phụ kiện.
                  </small>
                )}
              </div>

              {pinChon && (
                <div className="form-group">
                  <label className="form-label">Số lượng</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button"
                      onClick={() => setPinQty(q => Math.max(1, q - 1))}
                      style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>−</button>
                    <input type="number" min={1} max={pinChon.qty_in_stock}
                      value={pinQty}
                      onChange={e => setPinQty(Math.max(1, Math.min(pinChon.qty_in_stock, parseInt(e.target.value) || 1)))}
                      style={{ width: 60, textAlign: 'center', padding: '6px', borderRadius: 6, border: '1px solid #d1d5db' }} />
                    <button type="button"
                      onClick={() => setPinQty(q => Math.min(pinChon.qty_in_stock, q + 1))}
                      style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>+</button>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      Còn: {pinChon.qty_in_stock} pin
                    </span>
                  </div>

                  {/* Serial inputs */}
                  <BatterySerialInput
                    quantity={pinQty}
                    serials={pinSerials}
                    assignmentType="rent"
                    onChangeSerials={setPinSerials}
                    onChangeType={() => {/* always rent in this module */}}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <textarea className="form-control" rows={2}
                  value={formNotes} onChange={e => setFormNotes(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={createMut.isPending}>
                {createMut.isPending ? 'Đang tạo...' : '✓ Tạo phiếu thuê'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
