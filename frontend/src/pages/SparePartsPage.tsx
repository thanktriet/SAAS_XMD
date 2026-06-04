import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SparePart {
  id: string;
  code: string;
  name: string;
  category?: string;
  unit: string;
  qty_in_stock: number;
  qty_minimum: number;
  price_cost: number;
  price_sell: number;
  supplier?: string;
  is_active: boolean;
  created_at: string;
}

interface StockMovement {
  id: string;
  movement_type: 'import' | 'export' | 'adjustment';
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  notes?: string;
  created_at: string;
  users?: { full_name: string };
}

interface PartForm {
  code: string; name: string; category: string; unit: string;
  qty_minimum: number; price_cost: number; price_sell: number; supplier: string;
}

const formRong = (): PartForm => ({
  code: '', name: '', category: '', unit: 'cái',
  qty_minimum: 5, price_cost: 0, price_sell: 0, supplier: '',
});

const CATEGORIES = ['pin', 'lốp', 'đèn', 'phanh', 'động cơ', 'phụ kiện điện', 'khung', 'khác'];

const CAT_COLOR: Record<string, { bg: string; color: string }> = {
  'pin':            { bg: '#fef9c3', color: '#854d0e' },
  'lốp':           { bg: '#dcfce7', color: '#15803d' },
  'đèn':           { bg: '#fef3c7', color: '#b45309' },
  'phanh':         { bg: '#fee2e2', color: '#b91c1c' },
  'động cơ':       { bg: '#e0e7ff', color: '#4338ca' },
  'phụ kiện điện': { bg: '#f0fdf4', color: '#166534' },
  'khung':         { bg: '#f1f5f9', color: '#475569' },
  'khác':          { bg: '#f3f4f6', color: '#6b7280' },
};

const MV_CFG = {
  import:     { label: 'Nhập kho',   bg: '#dcfce7', color: '#16a34a', sign: '+' },
  export:     { label: 'Xuất kho',   bg: '#fef3c7', color: '#d97706', sign: '−' },
  adjustment: { label: 'Điều chỉnh', bg: '#e0e7ff', color: '#4338ca', sign: '~' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
type ErrAxios = { response?: { data?: { error?: string } } };
const fmtSo   = (n: number) => (n ?? 0).toLocaleString('vi-VN');
const fmtNgay = (s: string) => new Date(s).toLocaleDateString('vi-VN');

function BadgeCat({ cat }: { cat?: string }) {
  if (!cat) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  const c = CAT_COLOR[cat] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: c.bg, color: c.color }}>
      {cat}
    </span>
  );
}

function TonBadge({ qty, min }: { qty: number; min: number }) {
  if (qty <= 0)  return <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}>Hết hàng</span>;
  if (qty <= min) return <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: '#fffbeb', color: '#d97706', border: '1px solid #fcd34d' }}>⚠ {qty}</span>;
  return <span style={{ fontWeight: 700, color: '#16a34a', fontSize: 15 }}>{qty}</span>;
}

// ─── Trang chính ──────────────────────────────────────────────────────────────
export default function SparePartsPage() {
  const qc = useQueryClient();

  const [search, setSearch]           = useState('');
  const [locCategory, setLocCategory] = useState('');
  const [hienModal, setHienModal]     = useState(false);
  const [dangSua, setDangSua]         = useState<SparePart | null>(null);
  const [form, setForm]               = useState<PartForm>(formRong());

  const [modalKho, setModalKho]   = useState<null | 'in' | 'out'>(null);
  const [partChon, setPartChon]   = useState<SparePart | null>(null);
  const [soLuongKho, setSLKho]    = useState(1);
  const [ghiChuKho, setGhiChuKho] = useState('');

  const [modalLS, setModalLS] = useState(false);
  const [partLS, setPartLS]   = useState<SparePart | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['spare-parts', search, locCategory],
    queryFn: async () => {
      const params: Record<string, string> = { is_active: 'all', limit: '200' };
      if (search)      params.search   = search;
      if (locCategory) params.category = locCategory;
      return (await api.get('/inventory/spare-parts', { params })).data as { data: SparePart[]; total: number };
    },
  });

  const { data: lichSuData, isLoading: loadingLS } = useQuery({
    queryKey: ['spare-part-movements', partLS?.id],
    queryFn: async () =>
      (await api.get(`/inventory/spare-parts/${partLS!.id}/movements`)).data as { data: StockMovement[]; total: number },
    enabled: !!partLS,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const tao = useMutation({
    mutationFn: (body: PartForm) => api.post('/inventory/spare-parts', body),
    onSuccess: () => { toast.success('Đã thêm phụ tùng'); qc.invalidateQueries({ queryKey: ['spare-parts'] }); dongModal(); },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi tạo phụ tùng'),
  });
  const sua = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PartForm> }) => api.put(`/inventory/spare-parts/${id}`, body),
    onSuccess: () => { toast.success('Đã cập nhật'); qc.invalidateQueries({ queryKey: ['spare-parts'] }); dongModal(); },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi cập nhật'),
  });
  const nhapKho = useMutation({
    mutationFn: ({ id, qty, notes }: { id: string; qty: number; notes: string }) =>
      api.post(`/inventory/spare-parts/${id}/stock-in`, { quantity: qty, notes }),
    onSuccess: (res) => { toast.success(res.data.message); qc.invalidateQueries({ queryKey: ['spare-parts'] }); dongModalKho(); },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi nhập kho'),
  });
  const xuatKho = useMutation({
    mutationFn: ({ id, qty, notes }: { id: string; qty: number; notes: string }) =>
      api.post(`/inventory/spare-parts/${id}/stock-out`, { quantity: qty, notes }),
    onSuccess: (res) => { toast.success(res.data.message); qc.invalidateQueries({ queryKey: ['spare-parts'] }); dongModalKho(); },
    onError: (e: ErrAxios) => toast.error(e.response?.data?.error || 'Lỗi xuất kho'),
  });

  // ─── Helpers UI ─────────────────────────────────────────────────────────────
  const moTaoMoi   = () => { setDangSua(null); setForm(formRong()); setHienModal(true); };
  const moChinhSua = (p: SparePart) => {
    setDangSua(p);
    setForm({ code: p.code, name: p.name, category: p.category || '', unit: p.unit,
      qty_minimum: p.qty_minimum, price_cost: p.price_cost, price_sell: p.price_sell, supplier: p.supplier || '' });
    setHienModal(true);
  };
  const dongModal    = () => { setHienModal(false); setDangSua(null); setForm(formRong()); };
  const moNhapKho    = (p: SparePart) => { setPartChon(p); setSLKho(1); setGhiChuKho(''); setModalKho('in'); };
  const moXuatKho    = (p: SparePart) => { setPartChon(p); setSLKho(1); setGhiChuKho(''); setModalKho('out'); };
  const dongModalKho = () => { setModalKho(null); setPartChon(null); setSLKho(1); setGhiChuKho(''); };
  const moLichSu     = (p: SparePart) => { setPartLS(p); setModalLS(true); };
  const dongLS       = () => { setModalLS(false); setPartLS(null); };

  const guiForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (dangSua) {
      const { name, category, unit, qty_minimum, price_cost, price_sell, supplier } = form;
      sua.mutate({ id: dangSua.id, body: { name, category, unit, qty_minimum, price_cost, price_sell, supplier } });
    } else tao.mutate(form);
  };
  const guiKho = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partChon) return;
    if (modalKho === 'in') nhapKho.mutate({ id: partChon.id, qty: soLuongKho, notes: ghiChuKho });
    else                   xuatKho.mutate({ id: partChon.id, qty: soLuongKho, notes: ghiChuKho });
  };

  const ds         = data?.data ?? [];
  const soHetHang  = ds.filter(p => p.qty_in_stock <= 0).length;
  const soThapTon  = ds.filter(p => p.qty_in_stock > 0 && p.qty_in_stock <= p.qty_minimum).length;
  const tongGiaTri = ds.reduce((s, p) => s + p.qty_in_stock * p.price_cost, 0);

  return (
    <div className="page-container">

      {/* ── Tiêu đề ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🔩 Quản lý phụ tùng</h1>
          <p className="page-subtitle">Tồn kho phụ tùng, linh kiện & lịch sử nhập/xuất</p>
        </div>
        <button className="btn btn-primary" onClick={moTaoMoi}>+ Thêm phụ tùng</button>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {([
          { icon: '📦', label: 'Tổng mã hàng',   val: String(ds.length),          color: '#2563eb', bg: '#eff6ff' },
          { icon: '❌', label: 'Hết hàng',        val: String(soHetHang),          color: '#dc2626', bg: '#fef2f2' },
          { icon: '⚠️', label: 'Sắp hết',         val: String(soThapTon),          color: '#d97706', bg: '#fffbeb' },
          { icon: '💰', label: 'Giá trị tồn kho', val: fmtSo(tongGiaTri) + '₫',   color: '#059669', bg: '#ecfdf5' },
        ] as const).map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '14px 18px', border: `1px solid ${s.color}22` }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Cảnh báo ── */}
      {(soHetHang > 0 || soThapTon > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {soHetHang > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '9px 16px', color: '#dc2626', fontSize: 13, fontWeight: 500 }}>
              🚨 <strong>{soHetHang}</strong> phụ tùng đã hết hàng — cần đặt mua ngay
            </div>
          )}
          {soThapTon > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '9px 16px', color: '#d97706', fontSize: 13, fontWeight: 500 }}>
              ⚠️ <strong>{soThapTon}</strong> phụ tùng sắp hết hàng
            </div>
          )}
        </div>
      )}

      {/* ── Bộ lọc ── */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input placeholder="Tìm theo mã, tên phụ tùng..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="filter-select" value={locCategory} onChange={e => setLocCategory(e.target.value)}>
            <option value="">Tất cả loại</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {(search || locCategory) && (
            <button className="btn btn-secondary" style={{ padding: '7px 12px' }}
              onClick={() => { setSearch(''); setLocCategory(''); }}>✕ Xóa lọc</button>
          )}
        </div>
      </div>

      {/* ── Bảng ── */}
      <div className="card">
        {isLoading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : ds.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔩</div>
            <p>Không có phụ tùng nào{search ? ` khớp với "${search}"` : ''}</p>
          </div>
        ) : (
          <table className="table mobile-cards">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên phụ tùng</th>
                <th className="hide-mobile">Loại</th>
                <th style={{ textAlign: 'center' }}>Tồn kho</th>
                <th style={{ textAlign: 'right' }} className="hide-mobile">Giá nhập</th>
                <th style={{ textAlign: 'right' }}>Giá bán</th>
                <th style={{ textAlign: 'center' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {ds.map(p => (
                <tr key={p.id} style={!p.is_active ? { opacity: 0.45 } : undefined}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: 12.5, background: '#f1f5f9', padding: '2px 8px', borderRadius: 5, color: '#475569', fontWeight: 600 }}>
                      {p.code}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    {p.supplier && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 1 }}>📦 {p.supplier}</div>}
                  </td>
                  <td><BadgeCat cat={p.category} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <TonBadge qty={p.qty_in_stock} min={p.qty_minimum} />
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>min {p.qty_minimum} {p.unit}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13, color: '#6b7280' }}>
                    {p.price_cost > 0 ? fmtSo(p.price_cost) + '₫' : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>
                    {p.price_sell > 0 ? fmtSo(p.price_sell) + '₫' : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                      <button onClick={() => moNhapKho(p)}
                        style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#dcfce7', color: '#16a34a' }}>
                        ↑ Nhập
                      </button>
                      <button onClick={() => moXuatKho(p)}
                        style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#fef9c3', color: '#b45309' }}>
                        ↓ Xuất
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => moLichSu(p)}>Lịch sử</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => moChinhSua(p)}>Sửa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <div style={{ padding: '10px 20px', color: '#6b7280', fontSize: 13, borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
            <span>Tổng <strong>{data.total}</strong> phụ tùng</span>
            <span>Giá trị tồn: <strong style={{ color: '#059669' }}>{fmtSo(tongGiaTri)}₫</strong></span>
          </div>
        )}
      </div>

      {/* ══ Modal tạo / sửa phụ tùng ═══════════════════════════════════════════ */}
      {hienModal && (
        <div className="modal-overlay" onClick={dongModal}>
          <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{dangSua ? `✏️ Sửa: ${dangSua.name}` : '➕ Thêm phụ tùng mới'}</span>
              <button className="modal-close" onClick={dongModal}>✕</button>
            </div>
            <form onSubmit={guiForm}>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {!dangSua && (
                  <div className="form-group">
                    <label className="form-label">Mã phụ tùng *</label>
                    <input className="input" required value={form.code}
                      onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="PT001" />
                  </div>
                )}
                <div className="form-group" style={{ gridColumn: dangSua ? '1/3' : undefined }}>
                  <label className="form-label">Tên phụ tùng *</label>
                  <input className="input" required value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Lốp xe 3.00-10" />
                </div>
                <div className="form-group">
                  <label className="form-label">Loại</label>
                  <select className="input" value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">— Chọn loại —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Đơn vị</label>
                  <input className="input" value={form.unit}
                    onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="cái / bộ / lít" />
                </div>
                <div className="form-group">
                  <label className="form-label">Tồn tối thiểu</label>
                  <input className="input" type="number" min={0} value={form.qty_minimum}
                    onChange={e => setForm(f => ({ ...f, qty_minimum: +e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nhà cung cấp</label>
                  <input className="input" value={form.supplier}
                    onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Tên NCC" />
                </div>
                <div className="form-group">
                  <label className="form-label">Giá nhập (₫)</label>
                  <input className="input" type="number" min={0} step={1000} value={form.price_cost}
                    onChange={e => setForm(f => ({ ...f, price_cost: +e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Giá bán (₫)</label>
                  <input className="input" type="number" min={0} step={1000} value={form.price_sell}
                    onChange={e => setForm(f => ({ ...f, price_sell: +e.target.value }))} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={dongModal}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={tao.isPending || sua.isPending}>
                  {(tao.isPending || sua.isPending) ? 'Đang lưu...' : (dangSua ? 'Lưu thay đổi' : 'Thêm phụ tùng')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Modal nhập / xuất kho ════════════════════════════════════════════════ */}
      {modalKho && partChon && (
        <div className="modal-overlay" onClick={dongModalKho}>
          <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"
              style={{ background: modalKho === 'in' ? '#f0fdf4' : '#fffbeb', borderRadius: '12px 12px 0 0' }}>
              <span className="modal-title">
                {modalKho === 'in' ? '📥 Nhập kho' : '📤 Xuất kho'} — {partChon.name}
              </span>
              <button className="modal-close" onClick={dongModalKho}>✕</button>
            </div>
            <form onSubmit={guiKho}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Preview số lượng trước/sau */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em' }}>Tồn hiện tại</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: '#1e40af', lineHeight: 1 }}>{partChon.qty_in_stock}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{partChon.unit}</div>
                  </div>
                  <div style={{ background: modalKho === 'in' ? '#f0fdf4' : '#fffbeb', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em' }}>Sau khi {modalKho === 'in' ? 'nhập' : 'xuất'}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: modalKho === 'in' ? '#16a34a' : '#d97706' }}>
                      {modalKho === 'in' ? partChon.qty_in_stock + soLuongKho : partChon.qty_in_stock - soLuongKho}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{partChon.unit}</div>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{modalKho === 'in' ? 'Số lượng nhập *' : 'Số lượng xuất *'}</label>
                  <input className="input" type="number" required min={1}
                    max={modalKho === 'out' ? partChon.qty_in_stock : undefined}
                    value={soLuongKho} onChange={e => setSLKho(Math.max(1, +e.target.value))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Ghi chú</label>
                  <input className="input" value={ghiChuKho}
                    onChange={e => setGhiChuKho(e.target.value)} placeholder="Lý do nhập/xuất..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={dongModalKho}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={nhapKho.isPending || xuatKho.isPending}>
                  {(nhapKho.isPending || xuatKho.isPending) ? 'Đang xử lý...'
                    : modalKho === 'in' ? '✓ Xác nhận nhập kho' : '✓ Xác nhận xuất kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Modal lịch sử ════════════════════════════════════════════════════════ */}
      {modalLS && partLS && (
        <div className="modal-overlay" onClick={dongLS}>
          <div className="modal" style={{ width: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Lịch sử kho — {partLS.name}</span>
              <button className="modal-close" onClick={dongLS}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {loadingLS ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : (lichSuData?.data ?? []).length === 0 ? (
                <div className="empty-state"><p>Chưa có lịch sử nhập/xuất</p></div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Loại</th>
                      <th style={{ textAlign: 'right' }}>Số lượng</th>
                      <th style={{ textAlign: 'right' }}>Trước</th>
                      <th style={{ textAlign: 'right' }}>Sau</th>
                      <th>Người thực hiện</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lichSuData?.data ?? []).map(mv => {
                      const cfg = MV_CFG[mv.movement_type];
                      return (
                        <tr key={mv.id}>
                          <td style={{ fontSize: 12.5, color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtNgay(mv.created_at)}</td>
                          <td>
                            <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: cfg.bg, color: cfg.color }}>
                              {cfg.label}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: mv.movement_type === 'import' ? '#16a34a' : '#d97706' }}>
                            {cfg.sign}{mv.quantity}
                          </td>
                          <td style={{ textAlign: 'right', color: '#9ca3af', fontSize: 13 }}>{mv.quantity_before}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{mv.quantity_after}</td>
                          <td style={{ fontSize: 12.5 }}>{mv.users?.full_name || '—'}</td>
                          <td style={{ fontSize: 12.5, color: '#6b7280' }}>{mv.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={dongLS}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
