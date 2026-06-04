import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Supplier {
  id: string;
  supplier_code: string;
  supplier_name: string;
  phone?: string;
  email?: string;
  address?: string;
  tax_code?: string;
  bank_account?: string;
  bank_name?: string;
  contact_person?: string;   // ← tên cột thực tế trong acc_suppliers
  payment_terms: number;
  is_active: boolean;
  created_at: string;
}

interface SupplierForm {
  supplier_name: string; phone: string; email: string; address: string;
  tax_code: string; bank_account: string; bank_name: string;
  contact_person: string; payment_terms: number;
}

const formRong = (): SupplierForm => ({
  supplier_name: '', phone: '', email: '', address: '',
  tax_code: '', bank_account: '', bank_name: '',
  contact_person: '', payment_terms: 30,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
type ErrAxios = { response?: { data?: { error?: string } } };
const fmtNgay = (s: string) => new Date(s).toLocaleDateString('vi-VN');

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600,
      background: active ? '#dcfce7' : '#f3f4f6',
      color:      active ? '#16a34a' : '#9ca3af',
      border: `1px solid ${active ? '#86efac' : '#e5e7eb'}`,
    }}>
      {active ? '● Hoạt động' : '○ Ngừng'}
    </span>
  );
}

function InfoRow({ icon, label, val }: { icon: string; label: string; val: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
      <span style={{ flexShrink: 0, fontSize: 14 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 1 }}>{label}</div>
        <div style={{ color: '#374151', fontWeight: 500 }}>{val}</div>
      </div>
    </div>
  );
}

// ─── Trang chính ──────────────────────────────────────────────────────────────
export default function SuppliersPage() {
  const qc = useQueryClient();

  const [search, setSearch]       = useState('');
  const [hienModal, setHienModal] = useState(false);
  const [dangSua, setDangSua]     = useState<Supplier | null>(null);
  const [form, setForm]           = useState<SupplierForm>(formRong());
  const [chiTiet, setChiTiet]     = useState<Supplier | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '200' };
      if (search) params.search = search;
      return (await api.get('/purchase-orders/suppliers', { params })).data as { data: Supplier[]; total: number };
    },
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const tao = useMutation({
    mutationFn: (body: SupplierForm) => api.post('/purchase-orders/suppliers', body),
    onSuccess: () => { toast.success('Đã thêm nhà cung cấp'); qc.invalidateQueries({ queryKey: ['suppliers'] }); dongModal(); },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi tạo NCC'),
  });
  const sua = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<SupplierForm> }) =>
      api.put(`/purchase-orders/suppliers/${id}`, body),
    onSuccess: (_, vars) => {
      toast.success('Đã cập nhật');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      // Cập nhật luôn panel chi tiết nếu đang xem
      if (chiTiet?.id === vars.id) setChiTiet(prev => prev ? { ...prev, ...vars.body } : null);
      dongModal();
    },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi cập nhật'),
  });
  const doiTrangThai = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/purchase-orders/suppliers/${id}`, { is_active }),
    onSuccess: (_, vars) => {
      toast.success('Đã cập nhật trạng thái');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      if (chiTiet?.id === vars.id) setChiTiet(prev => prev ? { ...prev, is_active: vars.is_active } : null);
    },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi'),
  });

  // ─── UI helpers ─────────────────────────────────────────────────────────────
  const moTaoMoi   = () => { setDangSua(null); setForm(formRong()); setHienModal(true); };
  const moChinhSua = (s: Supplier) => {
    setDangSua(s);
    setForm({
      supplier_name: s.supplier_name, phone: s.phone || '', email: s.email || '',
      address: s.address || '', tax_code: s.tax_code || '',
      bank_account: s.bank_account || '', bank_name: s.bank_name || '',
      contact_person: s.contact_person || '', payment_terms: s.payment_terms,
    });
    setHienModal(true);
  };
  const dongModal = () => { setHienModal(false); setDangSua(null); setForm(formRong()); };

  const guiForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (dangSua) sua.mutate({ id: dangSua.id, body: form });
    else         tao.mutate(form);
  };

  const ds         = data?.data ?? [];
  const soHoatDong = ds.filter(s => s.is_active).length;
  const soNgung    = ds.filter(s => !s.is_active).length;

  return (
    <div className="page-container">

      {/* ── Tiêu đề ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🏭 Nhà cung cấp</h1>
          <p className="page-subtitle">Danh sách nhà cung cấp xe, phụ tùng và phụ kiện</p>
        </div>
        <button className="btn btn-primary" onClick={moTaoMoi}>+ Thêm nhà cung cấp</button>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        {([
          { icon: '🏭', label: 'Tổng NCC',       val: ds.length,  color: '#2563eb', bg: '#eff6ff' },
          { icon: '✅', label: 'Đang hoạt động', val: soHoatDong, color: '#16a34a', bg: '#f0fdf4' },
          { icon: '⏸️', label: 'Ngừng hợp tác', val: soNgung,    color: '#9ca3af', bg: '#f9fafb' },
        ] as const).map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '14px 18px', border: `1px solid ${s.color}22` }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Bộ lọc ── */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="search-box">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input placeholder="Tìm theo tên, mã NCC, số điện thoại..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* ── Layout 2 cột: danh sách + chi tiết ── */}
      <div style={{ display: 'grid', gridTemplateColumns: chiTiet ? '1fr 360px' : '1fr', gap: 16, alignItems: 'flex-start' }}>

        {/* Bảng danh sách */}
        <div className="card">
          {isLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : ds.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 40, marginBottom: 8 }}>🏭</div>
              <p>Chưa có nhà cung cấp nào</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Mã NCC</th>
                  <th>Tên nhà cung cấp</th>
                  <th>Liên hệ</th>
                  <th style={{ textAlign: 'center' }}>Công nợ (ngày)</th>
                  <th style={{ textAlign: 'center' }}>Trạng thái</th>
                  <th style={{ textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {ds.map(s => (
                  <tr key={s.id}
                    style={{ cursor: 'pointer', background: chiTiet?.id === s.id ? '#eff6ff' : undefined }}
                    onClick={() => setChiTiet(chiTiet?.id === s.id ? null : s)}>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: 12.5, background: '#f1f5f9', padding: '2px 8px', borderRadius: 5, color: '#475569', fontWeight: 600 }}>
                        {s.supplier_code}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.supplier_name}</div>
                      {s.contact_person && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 1 }}>👤 {s.contact_person}</div>}
                    </td>
                    <td>
                      {s.phone && <div style={{ fontSize: 13 }}>📞 {s.phone}</div>}
                      {s.email && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>✉️ {s.email}</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 18, color: '#1e40af' }}>{s.payment_terms}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af', display: 'block' }}>ngày</span>
                    </td>
                    <td style={{ textAlign: 'center' }}><ActiveBadge active={s.is_active} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => moChinhSua(s)}>Sửa</button>
                        <button
                          style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: s.is_active ? '#fef2f2' : '#f0fdf4', color: s.is_active ? '#dc2626' : '#16a34a' }}
                          onClick={() => doiTrangThai.mutate({ id: s.id, is_active: !s.is_active })}>
                          {s.is_active ? 'Ngừng' : 'Kích hoạt'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && (
            <div style={{ padding: '10px 20px', color: '#6b7280', fontSize: 13, borderTop: '1px solid #f3f4f6' }}>
              Tổng <strong>{data.total}</strong> nhà cung cấp
            </div>
          )}
        </div>

        {/* Panel chi tiết */}
        {chiTiet && (
          <div className="card" style={{ position: 'sticky', top: 16, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg,#eff6ff,#e0e7ff)', borderBottom: '1px solid #e0e7ff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1e3a8a' }}>{chiTiet.supplier_name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  <span style={{ fontFamily: 'monospace', background: '#dbeafe', padding: '1px 6px', borderRadius: 4, color: '#1d4ed8' }}>{chiTiet.supplier_code}</span>
                  <span style={{ marginLeft: 6 }}>Từ {fmtNgay(chiTiet.created_at)}</span>
                </div>
                <div style={{ marginTop: 6 }}><ActiveBadge active={chiTiet.is_active} /></div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af' }}
                onClick={() => setChiTiet(null)}>✕</button>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Liên hệ */}
              <section>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>THÔNG TIN LIÊN HỆ</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {chiTiet.contact_person && <InfoRow icon="👤" label="Người liên hệ"  val={chiTiet.contact_person} />}
                  {chiTiet.phone        && <InfoRow icon="📞" label="Số điện thoại"  val={chiTiet.phone} />}
                  {chiTiet.email        && <InfoRow icon="✉️" label="Email"           val={chiTiet.email} />}
                  {chiTiet.address      && <InfoRow icon="📍" label="Địa chỉ"         val={chiTiet.address} />}
                  {chiTiet.tax_code     && <InfoRow icon="🏷️" label="Mã số thuế"      val={chiTiet.tax_code} />}
                  {!chiTiet.phone && !chiTiet.email && !chiTiet.address && (
                    <div style={{ color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>Chưa có thông tin liên hệ</div>
                  )}
                </div>
              </section>

              {/* Ngân hàng */}
              {(chiTiet.bank_account || chiTiet.bank_name) && (
                <section>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>THÔNG TIN NGÂN HÀNG</div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
                    {chiTiet.bank_name && (
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{chiTiet.bank_name}</div>
                    )}
                    {chiTiet.bank_account && (
                      <div style={{ fontFamily: 'monospace', fontSize: 15, color: '#1e40af', letterSpacing: 1.5, fontWeight: 700 }}>
                        {chiTiet.bank_account}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Điều khoản thanh toán */}
              <section>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>ĐIỀU KHOẢN THANH TOÁN</div>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: '#1e40af', lineHeight: 1 }}>{chiTiet.payment_terms}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>ngày</div>
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                    Thanh toán trong vòng <strong>{chiTiet.payment_terms} ngày</strong> sau khi nhận hàng
                  </div>
                </div>
              </section>
            </div>

            <div style={{ padding: '12px 16px', borderTop: '1px solid #f3f4f6', display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => moChinhSua(chiTiet)}>
                ✏️ Chỉnh sửa
              </button>
              <button
                style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: chiTiet.is_active ? '#fef2f2' : '#f0fdf4', color: chiTiet.is_active ? '#dc2626' : '#16a34a' }}
                onClick={() => doiTrangThai.mutate({ id: chiTiet.id, is_active: !chiTiet.is_active })}>
                {chiTiet.is_active ? 'Ngừng HĐ' : 'Kích hoạt'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══ Modal tạo / sửa NCC ══════════════════════════════════════════════════ */}
      {hienModal && (
        <div className="modal-overlay" onClick={dongModal}>
          <div className="modal" style={{ width: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{dangSua ? `✏️ Sửa: ${dangSua.supplier_name}` : '➕ Thêm nhà cung cấp mới'}</span>
              <button className="modal-close" onClick={dongModal}>✕</button>
            </div>
            <form onSubmit={guiForm}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Thông tin chính */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #f3f4f6' }}>
                    THÔNG TIN CHÍNH
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-group" style={{ gridColumn: '1/3' }}>
                      <label className="form-label">Tên nhà cung cấp *</label>
                      <input className="input" required value={form.supplier_name}
                        onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
                        placeholder="Công ty TNHH ABC" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Người liên hệ</label>
                      <input className="input" value={form.contact_person}
                        onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="Nguyễn Văn A" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Mã số thuế</label>
                      <input className="input" value={form.tax_code}
                        onChange={e => setForm(f => ({ ...f, tax_code: e.target.value }))} placeholder="0123456789" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Số điện thoại</label>
                      <input className="input" value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0901 234 567" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="input" type="email" value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="sales@abc.vn" />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1/3' }}>
                      <label className="form-label">Địa chỉ</label>
                      <input className="input" value={form.address}
                        onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Nguyễn Huệ, Q.1, TP.HCM" />
                    </div>
                  </div>
                </div>

                {/* Ngân hàng */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #f3f4f6' }}>
                    THÔNG TIN NGÂN HÀNG
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label">Tên ngân hàng</label>
                      <input className="input" value={form.bank_name}
                        onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Vietcombank, BIDV..." />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Số tài khoản</label>
                      <input className="input" value={form.bank_account}
                        onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} placeholder="0123456789" />
                    </div>
                  </div>
                </div>

                {/* Điều khoản */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #f3f4f6' }}>
                    ĐIỀU KHOẢN THANH TOÁN
                  </div>
                  <div className="form-group" style={{ maxWidth: 200 }}>
                    <label className="form-label">Số ngày thanh toán</label>
                    <input className="input" type="number" min={0} max={365} value={form.payment_terms}
                      onChange={e => setForm(f => ({ ...f, payment_terms: +e.target.value }))} />
                    <div className="form-hint">0 = thanh toán ngay khi nhận hàng</div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={dongModal}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={tao.isPending || sua.isPending}>
                  {(tao.isPending || sua.isPending) ? 'Đang lưu...' : (dangSua ? 'Lưu thay đổi' : 'Thêm nhà cung cấp')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
