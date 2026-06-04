import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useUploadImage } from '../hooks/useUploadImage';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Accessory {
  id: string;
  code: string;
  name: string;
  brand?: string;
  category?: string;
  unit: string;
  qty_in_stock: number;
  qty_minimum: number;
  price_cost: number;
  price_sell: number;
  compatible_models?: string[];
  supplier?: string;
  image_url?: string;
  note?: string;
  is_active: boolean;
  created_at: string;
}

interface Movement {
  id: string;
  movement_type: string;
  quantity: number;
  unit_cost: number;
  note?: string;
  order_id?: string;
  created_at: string;
  users?: { full_name: string };
}

type ErrAxios = { response?: { data?: { error?: string } } };

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'battery', label: 'Pin xe' },
  { value: 'weather', label: 'Thời tiết' },
  { value: 'luggage', label: 'Hành lý' },
  { value: 'safety',  label: 'Bảo hộ' },
  { value: 'comfort', label: 'Tiện nghi' },
  { value: 'decor',   label: 'Trang trí' },
  { value: 'other',   label: 'Khác' },
];

const MOVEMENT_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  import:            { label: 'Nhập kho',       color: '#15803d', bg: '#dcfce7' },
  export_sale:       { label: 'Xuất bán',        color: '#854d0e', bg: '#fef9c3' },
  export_gift:       { label: 'Tặng kèm xe',     color: '#6b21a8', bg: '#f3e8ff' },
  export_warranty:   { label: 'Xuất bảo hành',   color: '#c2410c', bg: '#ffedd5' },
  adjust_plus:       { label: 'Điều chỉnh +',    color: '#1d4ed8', bg: '#dbeafe' },
  adjust_minus:      { label: 'Điều chỉnh -',    color: '#dc2626', bg: '#fee2e2' },
  return:            { label: 'Trả NCC',          color: '#374151', bg: '#f3f4f6' },
};

const EXPORT_TYPES = [
  { value: 'export_sale',     label: 'Xuất bán' },
  { value: 'export_warranty', label: 'Xuất bảo hành' },
  { value: 'adjust_minus',    label: 'Điều chỉnh -' },
  { value: 'return',          label: 'Trả NCC' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtSo = (n: number) => (n ?? 0).toLocaleString('vi-VN');
const fmtNgay = (s: string) => new Date(s).toLocaleDateString('vi-VN');

const categoryLabel = (value?: string) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? value ?? '—';

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccessoriesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const laSales   = user?.role === 'sales';
  const laManager = user?.role === 'manager';
  // Sales: chỉ xem; Manager: được nhập/xuất, không sửa/xóa/thêm
  const khongDuocSua  = laSales || laManager;
  const khongDuocThem = laSales || laManager;
  const khongDuocXuatNhap = laSales;

  const { uploading: imgUploading, upload: uploadImg } = useUploadImage({
    bucket: 'vehicle-images',
    folder: 'accessories',
  });

  // Bộ lọc
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterActive, setFilterActive] = useState('all');

  // Modal states
  const [modalCreate, setModalCreate] = useState(false);
  const [modalEdit, setModalEdit] = useState<Accessory | null>(null);
  const [modalStockIn, setModalStockIn] = useState<Accessory | null>(null);
  const [modalStockOut, setModalStockOut] = useState<Accessory | null>(null);
  const [modalHistory, setModalHistory] = useState<Accessory | null>(null);

  // Form tạo/sửa
  const emptyForm = {
    name: '', brand: '', category: '', unit: 'cái',
    qty_minimum: 5, supplier: '', price_cost: 0, price_sell: 0, note: '',
    compatible_models: [] as string[],
    image_url: '',
  };
  const [form, setForm] = useState(emptyForm);

  // Form nhập kho
  const [stockInQty, setStockInQty] = useState('');
  const [stockInNote, setStockInNote] = useState('');

  // Form xuất kho
  const [stockOutQty, setStockOutQty] = useState('');
  const [stockOutType, setStockOutType] = useState('export_sale');
  const [stockOutNote, setStockOutNote] = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: listData, isLoading } = useQuery({
    queryKey: ['accessories', search, filterCategory, filterActive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCategory) params.set('category', filterCategory);
      if (filterActive !== 'all') params.set('is_active', filterActive);
      params.set('limit', '200');
      const res = await api.get(`/inventory/accessories?${params.toString()}`);
      return res.data as { data: Accessory[]; total: number };
    },
  });

  const { data: movementsData } = useQuery({
    queryKey: ['accessory-movements', modalHistory?.id],
    queryFn: async () => {
      const res = await api.get(`/inventory/accessories/${modalHistory!.id}/movements`);
      return res.data as { data: Movement[]; total: number };
    },
    enabled: !!modalHistory,
  });

  // Danh sách dòng xe để chọn compatible_models
  const { data: dsModelData } = useQuery({
    queryKey: ['vehicle-models-list'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data),
    staleTime: 300_000,
  });
  const dsModel: { id: string; model_name: string; brand: string }[] = dsModelData?.data ?? [];

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: typeof emptyForm) => api.post('/inventory/accessories', body),
    onSuccess: () => {
      toast.success('Thêm phụ kiện thành công');
      queryClient.invalidateQueries({ queryKey: ['accessories'] });
      setModalCreate(false);
      setForm(emptyForm);
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Thêm phụ kiện thất bại');
    },
  });

  const editMutation = useMutation({
    mutationFn: (body: typeof emptyForm) =>
      api.put(`/inventory/accessories/${modalEdit!.id}`, body),
    onSuccess: () => {
      toast.success('Cập nhật phụ kiện thành công');
      queryClient.invalidateQueries({ queryKey: ['accessories'] });
      setModalEdit(null);
      setForm(emptyForm);
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Cập nhật phụ kiện thất bại');
    },
  });

  const stockInMutation = useMutation({
    mutationFn: ({ id, qty, note }: { id: string; qty: number; note: string }) =>
      api.post(`/inventory/accessories/${id}/stock-in`, { quantity: qty, note }),
    onSuccess: () => {
      toast.success('Nhập kho thành công');
      queryClient.invalidateQueries({ queryKey: ['accessories'] });
      queryClient.invalidateQueries({ queryKey: ['accessory-movements'] });
      setModalStockIn(null);
      setStockInQty('');
      setStockInNote('');
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Nhập kho thất bại');
    },
  });

  const stockOutMutation = useMutation({
    mutationFn: ({
      id, qty, movement_type, note,
    }: { id: string; qty: number; movement_type: string; note: string }) =>
      api.post(`/inventory/accessories/${id}/stock-out`, { quantity: qty, movement_type, note }),
    onSuccess: () => {
      toast.success('Xuất kho thành công');
      queryClient.invalidateQueries({ queryKey: ['accessories'] });
      queryClient.invalidateQueries({ queryKey: ['accessory-movements'] });
      setModalStockOut(null);
      setStockOutQty('');
      setStockOutType('export_sale');
      setStockOutNote('');
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Xuất kho thất bại');
    },
  });

  // ─── Computed ───────────────────────────────────────────────────────────────

  const accessories = listData?.data ?? [];
  const tongMa = accessories.length;
  const hetHang = accessories.filter((a) => a.qty_in_stock === 0).length;
  const sapHet = accessories.filter((a) => a.qty_in_stock > 0 && a.qty_in_stock <= a.qty_minimum).length;
  const giaTriTon = accessories.reduce((sum, a) => sum + a.qty_in_stock * a.price_cost, 0);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleOpenCreate = () => {
    setForm(emptyForm);
    setModalCreate(true);
  };

  const handleOpenEdit = (acc: Accessory) => {
    setForm({
      name: acc.name,
      brand: acc.brand ?? '',
      category: acc.category ?? '',
      unit: acc.unit,
      qty_minimum: acc.qty_minimum,
      supplier: acc.supplier ?? '',
      price_cost: acc.price_cost,
      price_sell: acc.price_sell,
      note: acc.note ?? '',
      compatible_models: acc.compatible_models ?? [],
      image_url: acc.image_url ?? '',
    });
    setModalEdit(acc);
  };

  const handleSubmitCreate = () => {
    if (!form.name.trim()) { toast.error('Vui lòng nhập tên phụ kiện'); return; }
    if (!form.unit.trim()) { toast.error('Vui lòng nhập đơn vị tính'); return; }
    createMutation.mutate(form);
  };

  const handleSubmitEdit = () => {
    if (!form.name.trim()) { toast.error('Vui lòng nhập tên phụ kiện'); return; }
    if (!form.unit.trim()) { toast.error('Vui lòng nhập đơn vị tính'); return; }
    editMutation.mutate(form);
  };

  const handleStockIn = () => {
    const qty = parseInt(stockInQty, 10);
    if (!qty || qty <= 0) { toast.error('Số lượng phải lớn hơn 0'); return; }
    stockInMutation.mutate({ id: modalStockIn!.id, qty, note: stockInNote });
  };

  const handleStockOut = () => {
    const qty = parseInt(stockOutQty, 10);
    if (!qty || qty <= 0) { toast.error('Số lượng phải lớn hơn 0'); return; }
    if (qty > (modalStockOut?.qty_in_stock ?? 0)) {
      toast.error(`Tồn kho không đủ (hiện có: ${modalStockOut?.qty_in_stock ?? 0})`);
      return;
    }
    stockOutMutation.mutate({
      id: modalStockOut!.id,
      qty,
      movement_type: stockOutType,
      note: stockOutNote,
    });
  };

  const handleXoaLoc = () => {
    setSearch('');
    setFilterCategory('');
    setFilterActive('all');
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🎁 Quản lý phụ kiện</h1>
          <p className="page-subtitle">Quản lý tồn kho phụ kiện xe máy điện</p>
        </div>
        {!khongDuocThem && (
          <button className="btn btn-primary" onClick={handleOpenCreate}>
            + Thêm phụ kiện
          </button>
        )}
      </div>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="Tổng mã hàng" value={fmtSo(tongMa)} icon="📦" color="#3b82f6" />
        <StatCard label="Hết hàng" value={fmtSo(hetHang)} icon="🚫" color="#ef4444" />
        <StatCard label="Sắp hết" value={fmtSo(sapHet)} icon="⚠️" color="#f59e0b" />
        <StatCard
          label="Giá trị tồn kho"
          value={`${fmtSo(giaTriTon)} đ`}
          icon="💰"
          color="#10b981"
        />
      </div>

      {/* ── Cảnh báo ── */}
      {(hetHang > 0 || sapHet > 0) && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
              Cảnh báo tồn kho
            </div>
            <div style={{ color: '#78350f', fontSize: 14 }}>
              {hetHang > 0 && (
                <span>
                  <strong>{hetHang}</strong> mã hàng đã <strong>hết hàng</strong>.{' '}
                </span>
              )}
              {sapHet > 0 && (
                <span>
                  <strong>{sapHet}</strong> mã hàng <strong>sắp hết</strong> (dưới mức tối thiểu).
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Bộ lọc ── */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input search-box"
            placeholder="🔍 Tìm theo mã, tên, nhãn hiệu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 0 }}
          />
          <select
            className="filter-select"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ minWidth: 160 }}
          >
            <option value="">Tất cả loại</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            className="filter-select"
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
            style={{ minWidth: 140 }}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="true">Đang kinh doanh</option>
            <option value="false">Ngừng kinh doanh</option>
          </select>
          {(search || filterCategory || filterActive !== 'all') && (
            <button className="btn btn-secondary btn-sm" onClick={handleXoaLoc}>
              ✕ Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* ── Bảng dữ liệu ── */}
      <div className="card">
        {isLoading ? (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        ) : accessories.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 48 }}>🎁</div>
            <div>Chưa có phụ kiện nào</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table mobile-cards" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Mã hàng</th>
                  <th>Tên phụ kiện</th>
                  <th className="hide-mobile">Loại</th>
                  <th style={{ textAlign: 'right' }}>Tồn kho</th>
                  <th style={{ textAlign: 'right' }} className="hide-mobile">Giá nhập</th>
                  <th style={{ textAlign: 'right' }}>Giá bán</th>
                  <th style={{ textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {accessories.map((acc) => {
                  const isHet = acc.qty_in_stock === 0;
                  const isSapHet = acc.qty_in_stock > 0 && acc.qty_in_stock <= acc.qty_minimum;
                  return (
                    <tr key={acc.id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#3b82f6' }}>
                          {acc.code}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{acc.name}</div>
                        {acc.brand && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{acc.brand}</div>
                        )}
                      </td>
                      <td>
                        {acc.category ? (
                          <span
                            style={{
                              background: '#e0e7ff',
                              color: '#3730a3',
                              padding: '2px 10px',
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 500,
                            }}
                          >
                            {categoryLabel(acc.category)}
                          </span>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>—</span>
                        )}
                        {/* Dòng xe áp dụng */}
                        <div style={{ marginTop: 4 }}>
                          {!acc.compatible_models?.length ? (
                            <span style={{ fontSize: 11, color: '#059669', background: '#d1fae5', padding: '1px 7px', borderRadius: 999 }}>
                              Tất cả xe
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#6366f1', background: '#e0e7ff', padding: '1px 7px', borderRadius: 999 }}>
                              {acc.compatible_models.length} dòng xe
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            color: isHet ? '#ef4444' : isSapHet ? '#f59e0b' : '#15803d',
                          }}
                        >
                          {fmtSo(acc.qty_in_stock)} {acc.unit}
                        </span>
                        {isHet && (
                          <div style={{ fontSize: 11, color: '#ef4444' }}>HẾT HÀNG</div>
                        )}
                        {isSapHet && (
                          <div style={{ fontSize: 11, color: '#f59e0b' }}>Sắp hết</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', color: '#374151' }}>
                        {fmtSo(acc.price_cost)} đ
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                        {fmtSo(acc.price_sell)} đ
                      </td>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            justifyContent: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          {!khongDuocXuatNhap && (
                            <button
                              className="btn btn-sm"
                              title="Nhập kho"
                              style={{ background: '#dcfce7', color: '#15803d' }}
                              onClick={() => {
                                setStockInQty('');
                                setStockInNote('');
                                setModalStockIn(acc);
                              }}
                            >
                              ↓ Nhập
                            </button>
                          )}
                          {!khongDuocXuatNhap && (
                            <button
                              className="btn btn-sm"
                              title="Xuất kho"
                              style={{ background: '#fef9c3', color: '#854d0e' }}
                              onClick={() => {
                                setStockOutQty('');
                                setStockOutType('export_sale');
                                setStockOutNote('');
                                setModalStockOut(acc);
                              }}
                            >
                              ↑ Xuất
                            </button>
                          )}
                          <button
                            className="btn btn-sm"
                            title="Lịch sử"
                            style={{ background: '#e0e7ff', color: '#3730a3' }}
                            onClick={() => setModalHistory(acc)}
                          >
                            📋
                          </button>
                          {!khongDuocSua && (
                            <button
                              className="btn btn-sm"
                              title="Chỉnh sửa"
                              style={{ background: '#f3f4f6', color: '#374151' }}
                              onClick={() => handleOpenEdit(acc)}
                            >
                              ✏️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && accessories.length > 0 && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #e5e7eb',
              color: '#6b7280',
              fontSize: 14,
            }}
          >
            Hiển thị {accessories.length} / {listData?.total ?? 0} phụ kiện
          </div>
        )}
      </div>

      {/* ── Modal Tạo/Sửa ── */}
      {(modalCreate || modalEdit) && (
        <div className="modal-overlay" onClick={() => { setModalCreate(false); setModalEdit(null); }}>
          <div
            className="modal"
            style={{ maxWidth: 680, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">
                {modalCreate ? '+ Thêm phụ kiện mới' : `✏️ Sửa: ${modalEdit?.name}`}
              </h2>
              <button
                className="modal-close"
                onClick={() => { setModalCreate(false); setModalEdit(null); }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">
                    Tên phụ kiện <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    className="input"
                    placeholder="Ví dụ: Túi treo xe máy điện"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Nhãn hiệu</label>
                  <input
                    className="input"
                    placeholder="Ví dụ: VinFast, Honda..."
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Loại phụ kiện</label>
                  <select
                    className="input filter-select"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="">— Chọn loại —</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">
                    Đơn vị tính <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    className="input"
                    placeholder="Cái, bộ, chiếc..."
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tồn tối thiểu</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.qty_minimum}
                    onChange={(e) =>
                      setForm({ ...form, qty_minimum: parseInt(e.target.value, 10) || 0 })
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Nhà cung cấp</label>
                  <input
                    className="input"
                    placeholder="Tên nhà cung cấp"
                    value={form.supplier}
                    onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Giá nhập (đ)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.price_cost}
                    onChange={(e) =>
                      setForm({ ...form, price_cost: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Giá bán (đ)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.price_sell}
                    onChange={(e) =>
                      setForm({ ...form, price_sell: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">
                    Dòng xe áp dụng
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 6 }}>
                      (để trống = dùng cho tất cả xe)
                    </span>
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {dsModel.map(m => {
                      const checked = form.compatible_models.includes(m.id);
                      return (
                        <label key={m.id} style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                          border: `1px solid ${checked ? '#3b82f6' : '#e2e8f0'}`,
                          background: checked ? '#eff6ff' : '#fff',
                          fontSize: 13,
                        }}>
                          <input type="checkbox" checked={checked} onChange={() => {
                            setForm(prev => ({
                              ...prev,
                              compatible_models: checked
                                ? prev.compatible_models.filter(id => id !== m.id)
                                : [...prev.compatible_models, m.id],
                            }));
                          }} />
                          {m.brand} {m.model_name}
                        </label>
                      );
                    })}
                    {dsModel.length === 0 && (
                      <span style={{ color: '#888', fontSize: 13 }}>Chưa có dòng xe nào</span>
                    )}
                  </div>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Hình ảnh sản phẩm</label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 80, height: 80, borderRadius: 10, flexShrink: 0,
                      border: '1.5px dashed #cbd5e1', background: '#f8fafc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                    }}>
                      {form.image_url
                        ? <img src={form.image_url} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} onError={e => (e.currentTarget.style.display = 'none')} />
                        : <span style={{ fontSize: 28 }}>📦</span>
                      }
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <label
                          style={{
                            padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                            cursor: imgUploading ? 'wait' : 'pointer',
                            background: '#2563eb', color: '#fff',
                            display: 'inline-block',
                          }}
                        >
                          {imgUploading ? 'Đang upload...' : '📷 Upload ảnh'}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            disabled={imgUploading}
                            onChange={async e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const url = await uploadImg(file);
                              if (url) setForm({ ...form, image_url: url });
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {form.image_url && (
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, image_url: '' })}
                            style={{
                              padding: '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', background: '#fee2e2', color: '#991b1b',
                              border: 'none',
                            }}
                          >
                            🗑️ Xóa ảnh
                          </button>
                        )}
                      </div>
                      <input
                        className="input"
                        placeholder="Hoặc dán URL ảnh từ internet/CDN"
                        value={form.image_url}
                        onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                      />
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 5 }}>
                        Bấm Upload để chọn ảnh từ máy / chụp camera. Hoặc dán URL.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Ghi chú</label>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Ghi chú thêm về phụ kiện..."
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => { setModalCreate(false); setModalEdit(null); }}
              >
                Hủy
              </button>
              <button
                className="btn btn-primary"
                disabled={createMutation.isPending || editMutation.isPending}
                onClick={modalCreate ? handleSubmitCreate : handleSubmitEdit}
              >
                {createMutation.isPending || editMutation.isPending
                  ? 'Đang lưu...'
                  : modalCreate
                  ? 'Thêm phụ kiện'
                  : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Nhập kho ── */}
      {modalStockIn && (
        <div className="modal-overlay" onClick={() => setModalStockIn(null)}>
          <div
            className="modal"
            style={{ maxWidth: 460, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">↓ Nhập kho phụ kiện</h2>
              <button className="modal-close" onClick={() => setModalStockIn(null)}>×</button>
            </div>
            <div className="modal-body">
              {/* Thông tin phụ kiện */}
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 16,
                }}
              >
                <div style={{ fontWeight: 600, color: '#15803d', marginBottom: 4 }}>
                  {modalStockIn.code} — {modalStockIn.name}
                </div>
                <div style={{ fontSize: 14, color: '#374151' }}>
                  Tồn hiện tại:{' '}
                  <strong>
                    {fmtSo(modalStockIn.qty_in_stock)} {modalStockIn.unit}
                  </strong>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Số lượng nhập <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  placeholder="Nhập số lượng..."
                  value={stockInQty}
                  onChange={(e) => setStockInQty(e.target.value)}
                  autoFocus
                />
              </div>
              {/* Preview tồn sau nhập */}
              {stockInQty && parseInt(stockInQty, 10) > 0 && (
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 8,
                    padding: '10px 16px',
                    marginTop: -4,
                    marginBottom: 12,
                    fontSize: 14,
                    color: '#1d4ed8',
                  }}
                >
                  Sau khi nhập:{' '}
                  <strong>
                    {fmtSo(modalStockIn.qty_in_stock + parseInt(stockInQty, 10))}{' '}
                    {modalStockIn.unit}
                  </strong>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <input
                  className="input"
                  placeholder="Nhập từ nhà cung cấp, PO#..."
                  value={stockInNote}
                  onChange={(e) => setStockInNote(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModalStockIn(null)}>
                Hủy
              </button>
              <button
                className="btn btn-primary"
                disabled={stockInMutation.isPending}
                onClick={handleStockIn}
                style={{ background: '#15803d' }}
              >
                {stockInMutation.isPending ? 'Đang nhập...' : '↓ Xác nhận nhập kho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Xuất kho ── */}
      {modalStockOut && (
        <div className="modal-overlay" onClick={() => setModalStockOut(null)}>
          <div
            className="modal"
            style={{ maxWidth: 460, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">↑ Xuất kho phụ kiện</h2>
              <button className="modal-close" onClick={() => setModalStockOut(null)}>×</button>
            </div>
            <div className="modal-body">
              {/* Thông tin phụ kiện */}
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fcd34d',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 16,
                }}
              >
                <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                  {modalStockOut.code} — {modalStockOut.name}
                </div>
                <div style={{ fontSize: 14, color: '#374151' }}>
                  Tồn hiện tại:{' '}
                  <strong
                    style={{
                      color: modalStockOut.qty_in_stock === 0 ? '#ef4444' : '#374151',
                    }}
                  >
                    {fmtSo(modalStockOut.qty_in_stock)} {modalStockOut.unit}
                  </strong>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Loại xuất kho</label>
                <select
                  className="input filter-select"
                  value={stockOutType}
                  onChange={(e) => setStockOutType(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {EXPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Số lượng xuất <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={modalStockOut.qty_in_stock}
                  placeholder="Nhập số lượng..."
                  value={stockOutQty}
                  onChange={(e) => setStockOutQty(e.target.value)}
                  autoFocus
                />
              </div>
              {/* Preview tồn sau xuất */}
              {stockOutQty && parseInt(stockOutQty, 10) > 0 && (
                <div
                  style={{
                    background:
                      parseInt(stockOutQty, 10) > modalStockOut.qty_in_stock
                        ? '#fef2f2'
                        : '#eff6ff',
                    border: `1px solid ${
                      parseInt(stockOutQty, 10) > modalStockOut.qty_in_stock ? '#fecaca' : '#bfdbfe'
                    }`,
                    borderRadius: 8,
                    padding: '10px 16px',
                    marginTop: -4,
                    marginBottom: 12,
                    fontSize: 14,
                    color:
                      parseInt(stockOutQty, 10) > modalStockOut.qty_in_stock
                        ? '#dc2626'
                        : '#1d4ed8',
                  }}
                >
                  {parseInt(stockOutQty, 10) > modalStockOut.qty_in_stock ? (
                    <span>⚠️ Không đủ tồn kho!</span>
                  ) : (
                    <span>
                      Sau khi xuất:{' '}
                      <strong>
                        {fmtSo(modalStockOut.qty_in_stock - parseInt(stockOutQty, 10))}{' '}
                        {modalStockOut.unit}
                      </strong>
                    </span>
                  )}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <input
                  className="input"
                  placeholder="Lý do xuất, mã đơn hàng..."
                  value={stockOutNote}
                  onChange={(e) => setStockOutNote(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModalStockOut(null)}>
                Hủy
              </button>
              <button
                className="btn btn-primary"
                disabled={stockOutMutation.isPending}
                onClick={handleStockOut}
                style={{ background: '#c2410c' }}
              >
                {stockOutMutation.isPending ? 'Đang xuất...' : '↑ Xác nhận xuất kho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Lịch sử giao dịch ── */}
      {modalHistory && (
        <div className="modal-overlay" onClick={() => setModalHistory(null)}>
          <div
            className="modal"
            style={{ maxWidth: 780, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">
                📋 Lịch sử: {modalHistory.code} — {modalHistory.name}
              </h2>
              <button className="modal-close" onClick={() => setModalHistory(null)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              {!movementsData ? (
                <div className="loading-center" style={{ padding: 40 }}>
                  <div className="spinner" />
                </div>
              ) : movementsData.data.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div style={{ fontSize: 36 }}>📭</div>
                  <div>Chưa có giao dịch nào</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: 480 }}>
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Loại giao dịch</th>
                        <th style={{ textAlign: 'right' }}>Số lượng</th>
                        <th style={{ textAlign: 'right' }}>Đơn giá</th>
                        <th>Người thực hiện</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movementsData.data.map((mv) => {
                        const cfg = MOVEMENT_TYPE_CONFIG[mv.movement_type] ?? {
                          label: mv.movement_type,
                          color: '#374151',
                          bg: '#f3f4f6',
                        };
                        const isPlus =
                          mv.movement_type === 'import' || mv.movement_type === 'adjust_plus';
                        return (
                          <tr key={mv.id}>
                            <td style={{ whiteSpace: 'nowrap', color: '#6b7280', fontSize: 13 }}>
                              {fmtNgay(mv.created_at)}
                            </td>
                            <td>
                              <span
                                style={{
                                  background: cfg.bg,
                                  color: cfg.color,
                                  padding: '2px 10px',
                                  borderRadius: 999,
                                  fontSize: 12,
                                  fontWeight: 500,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {cfg.label}
                              </span>
                            </td>
                            <td
                              style={{
                                textAlign: 'right',
                                fontWeight: 600,
                                color: isPlus ? '#15803d' : '#dc2626',
                              }}
                            >
                              {isPlus ? '+' : '-'}
                              {fmtSo(mv.quantity)}
                            </td>
                            <td style={{ textAlign: 'right', color: '#374151' }}>
                              {mv.unit_cost ? `${fmtSo(mv.unit_cost)} đ` : '—'}
                            </td>
                            <td style={{ fontSize: 13, color: '#374151' }}>
                              {mv.users?.full_name ?? '—'}
                            </td>
                            <td style={{ fontSize: 13, color: '#6b7280', maxWidth: 180 }}>
                              <span
                                title={mv.note ?? ''}
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  display: 'block',
                                  maxWidth: 180,
                                }}
                              >
                                {mv.note || '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: '#6b7280' }}>
                {movementsData
                  ? `${movementsData.data.length} / ${movementsData.total} giao dịch`
                  : ''}
              </span>
              <button className="btn btn-secondary" onClick={() => setModalHistory(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Stat Card ─────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: string;
  color: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: `${color}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      </div>
    </div>
  );
}
