// Trang Mẫu xe — quản lý dòng xe, màu sắc, phiên bản, hình ảnh
import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { VehicleModel, VehicleVariant, PaginatedResponse } from '../types';
import { formatCurrency } from '../utils/helpers';
import { MAU_HEX, MAU_GOI_Y, mauToHex } from '../utils/colors';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { useUploadImage } from '../hooks/useUploadImage';
import './VehiclesPage.css';

// Một dòng màu kèm product_code (tương ứng vehicle_model_colors)
interface ModelColorRow {
  id:           string;
  color_name:   string;
  color_hex?:   string | null;
  image_url?:   string | null;
  product_code?: string | null;
  is_active?:   boolean;
  sort_order?:  number;
}

// ─── Giá trị khởi tạo form ───────────────────────────────────────────────────
const INIT_FORM = {
  brand:               '',
  model_name:          '',
  category:            'xe_may' as VehicleModel['category'],
  battery_capacity_kwh: '' as string | number,
  battery_type:        '',
  range_km:            '' as string | number,
  max_speed_kmh:       '' as string | number,
  price_cost:          '' as string | number,
  price_sell:          '' as string | number,
  warranty_months:     24 as string | number,
  description:         '',
  image_url:           '',
  is_active:           true,
  available_colors:    [] as string[],
  variants:            [] as VehicleVariant[],
};

const CATEGORY_LABEL: Record<string, string> = {
  xe_may:     '🛵 Xe máy',
  xe_tay_ga:  '🛺 Xe tay ga',
  xe_dap:     '🚲 Xe đạp điện',
  xe_ba_banh: '🛺 Xe 3 bánh',
};

// ─── Component chính ─────────────────────────────────────────────────────────
export default function VehiclesPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const chiXem = user?.role !== 'admin';   // chỉ admin mới được thêm/sửa/xóa

  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [modal, setModal]         = useState<'create' | 'edit' | 'detail' | null>(null);
  const [editing, setEditing]     = useState<VehicleModel | null>(null);
  const [form, setForm]           = useState({ ...INIT_FORM });

  // State màu sắc
  const [inputMau, setInputMau]   = useState('');

  // State phiên bản
  const [inputVariantTen, setInputVariantTen]   = useState('');
  const [inputVariantGia, setInputVariantGia]   = useState('');

  // Ref upload ảnh
  const imgRef = useRef<HTMLInputElement>(null);
  const { uploading: imgUploading, upload: uploadImg } = useUploadImage({ folder: 'vehicles' });

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<PaginatedResponse<VehicleModel>>({
    queryKey: ['vehicles', search, page],
    queryFn: () => api.get('/vehicles', { params: { search, page, limit: 12 } }).then(r => r.data),
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body: typeof form) => api.post('/vehicles', cleanForm(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle-models'] });
      setModal(null);
      toast.success('Thêm mẫu xe thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo mẫu xe'),
  });

  const updateMut = useMutation({
    mutationFn: (body: typeof form) => api.put(`/vehicles/${editing?.id}`, cleanForm(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle-models'] });
      setModal(null);
      toast.success('Cập nhật mẫu xe thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Đã xoá mẫu xe');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể xoá'),
  });

  // ─── Quản lý mã sản phẩm theo màu (chỉ load khi mở modal detail) ───────────
  const { data: colorsData } = useQuery<{ data: ModelColorRow[] }>({
    queryKey: ['model-colors', editing?.id],
    queryFn: () => api.get(`/vehicles/${editing!.id}/colors`).then(r => r.data),
    enabled: modal === 'detail' && !!editing?.id,
    staleTime: 30000,
  });
  const modelColors: ModelColorRow[] = colorsData?.data ?? [];

  // Cache mã đang gõ trên từng dòng để chỉ gọi API khi blur/Enter
  const [editingCodes, setEditingCodes] = useState<Record<string, string>>({});
  // Cache tên màu đang gõ — tách riêng khỏi mã SP
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  // State cho row "thêm màu mới"
  const [newColorName, setNewColorName] = useState('');
  const [newColorCode, setNewColorCode] = useState('');

  const updateColorMut = useMutation({
    mutationFn: ({ colorId, ...body }: { colorId: string; product_code?: string | null; color_name?: string }) =>
      api.patch(`/vehicles/colors/${colorId}`, body).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['model-colors', editing?.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      if ('product_code' in vars) {
        setEditingCodes(prev => {
          const { [vars.colorId]: _omit, ...rest } = prev;
          return rest;
        });
      }
      if ('color_name' in vars) {
        setEditingNames(prev => {
          const { [vars.colorId]: _omit, ...rest } = prev;
          return rest;
        });
      }
      toast.success('Đã lưu thay đổi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi lưu thay đổi'),
  });

  const addColorMut = useMutation({
    mutationFn: (body: { color_name: string; product_code?: string | null; color_hex?: string | null }) =>
      api.post(`/vehicles/${editing!.id}/colors`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-colors', editing?.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      setNewColorName('');
      setNewColorCode('');
      toast.success('Đã thêm màu');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi thêm màu'),
  });

  const deleteColorMut = useMutation({
    mutationFn: (colorId: string) => api.delete(`/vehicles/colors/${colorId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-colors', editing?.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Đã xoá màu');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể xoá màu'),
  });

  function luuMaSP(row: ModelColorRow) {
    const newVal = editingCodes[row.id];
    if (newVal === undefined) return;                    // chưa sửa gì
    if ((newVal || null) === (row.product_code || null)) {
      setEditingCodes(prev => {
        const { [row.id]: _omit, ...rest } = prev;
        return rest;
      });
      return;
    }
    updateColorMut.mutate({ colorId: row.id, product_code: newVal.trim() || null });
  }

  function luuTenMau(row: ModelColorRow) {
    const newVal = editingNames[row.id];
    if (newVal === undefined) return;
    const trimmed = newVal.trim();
    if (!trimmed) {
      toast.error('Tên màu không được để trống');
      return;
    }
    if (trimmed === row.color_name) {
      setEditingNames(prev => {
        const { [row.id]: _omit, ...rest } = prev;
        return rest;
      });
      return;
    }
    updateColorMut.mutate({ colorId: row.id, color_name: trimmed });
  }

  function themMauMoi() {
    const ten = newColorName.trim();
    if (!ten) { toast.error('Nhập tên màu'); return; }
    addColorMut.mutate({
      color_name:   ten,
      product_code: newColorCode.trim() || null,
      color_hex:    MAU_HEX[ten] || null,
    });
  }

  function xoaMauRow(row: ModelColorRow) {
    if (!confirm(`Xoá màu "${row.color_name}"?\n(Sẽ thất bại nếu còn xe trong kho dùng màu này)`)) return;
    deleteColorMut.mutate(row.id);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function cleanForm(f: typeof form) {
    return {
      ...f,
      battery_capacity_kwh: f.battery_capacity_kwh === '' ? null : Number(f.battery_capacity_kwh),
      range_km:       f.range_km      === '' ? null : Number(f.range_km),
      max_speed_kmh:  f.max_speed_kmh === '' ? null : Number(f.max_speed_kmh),
      price_cost:     Number(f.price_cost  || 0),
      price_sell:     Number(f.price_sell  || 0),
      warranty_months: Number(f.warranty_months || 24),
      available_colors: f.available_colors.length > 0 ? f.available_colors : null,
      variants:        f.variants.length > 0 ? f.variants : null,
      image_url:       f.image_url || null,
    };
  }

  const f = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  // ─── Mở modal ──────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({ ...INIT_FORM });
    setInputMau('');
    setInputVariantTen('');
    setInputVariantGia('');
    setEditing(null);
    setModal('create');
  };

  const openEdit = (v: VehicleModel) => {
    setEditing(v);
    setForm({
      brand:               v.brand,
      model_name:          v.model_name,
      category:            v.category ?? 'xe_may',
      battery_capacity_kwh: v.battery_capacity_kwh ?? '',
      battery_type:        v.battery_type ?? '',
      range_km:            v.range_km ?? '',
      max_speed_kmh:       v.max_speed_kmh ?? '',
      price_cost:          v.price_cost,
      price_sell:          v.price_sell,
      warranty_months:     v.warranty_months,
      description:         v.description ?? '',
      image_url:           v.image_url ?? '',
      is_active:           v.is_active ?? true,
      available_colors:    v.available_colors ?? [],
      variants:            v.variants ?? [],
    });
    setInputMau('');
    setInputVariantTen('');
    setInputVariantGia('');
    setModal('edit');
  };

  const openDetail = (v: VehicleModel) => {
    setEditing(v);
    setModal('detail');
  };

  // ─── Màu sắc ───────────────────────────────────────────────────────────────
  const themMau = (mau: string) => {
    const m = mau.trim();
    if (!m) return;
    if (form.available_colors.includes(m)) return;
    setForm(prev => ({ ...prev, available_colors: [...prev.available_colors, m] }));
    setInputMau('');
  };

  const xoaMau = (mau: string) =>
    setForm(prev => ({ ...prev, available_colors: prev.available_colors.filter(c => c !== mau) }));

  // ─── Phiên bản ─────────────────────────────────────────────────────────────
  const themVariant = () => {
    const ten = inputVariantTen.trim();
    if (!ten) { toast.error('Nhập tên phiên bản'); return; }
    const gia = Number(inputVariantGia.replace(/\D/g, '') || 0);
    if (form.variants.find(v => v.ten === ten)) { toast.error('Phiên bản đã tồn tại'); return; }
    setForm(prev => ({ ...prev, variants: [...prev.variants, { ten, gia_chen_them: gia }] }));
    setInputVariantTen('');
    setInputVariantGia('');
  };

  const xoaVariant = (ten: string) =>
    setForm(prev => ({ ...prev, variants: prev.variants.filter(v => v.ten !== ten) }));

  // ─── Upload ảnh → Supabase Storage → lấy URL ──────────────────────────────
  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Hiện preview local ngay lập tức (UX tốt hơn)
    const localUrl = URL.createObjectURL(file);
    setForm(p => ({ ...p, image_url: localUrl }));
    // Upload lên Storage, cập nhật URL thật
    const publicUrl = await uploadImg(file);
    if (publicUrl) {
      setForm(p => ({ ...p, image_url: publicUrl }));
      URL.revokeObjectURL(localUrl);
    } else {
      // Upload thất bại → xoá preview
      setForm(p => ({ ...p, image_url: '' }));
      URL.revokeObjectURL(localUrl);
    }
    // Reset input để chọn lại cùng file nếu cần
    if (imgRef.current) imgRef.current.value = '';
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.brand.trim())      { toast.error('Nhập hãng xe'); return; }
    if (!form.model_name.trim()) { toast.error('Nhập tên mẫu xe'); return; }
    if (!form.price_sell)        { toast.error('Nhập giá bán'); return; }
    modal === 'create' ? createMut.mutate(form) : updateMut.mutate(form);
  };

  const totalPages = Math.ceil((data?.total || 0) / 12);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🏍️ Danh mục Mẫu xe</span>
        {!chiXem && <button className="btn btn-primary" onClick={openCreate}>+ Thêm mẫu xe</button>}
      </div>

      <div className="page-content">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Mẫu xe ({data?.total ?? 0})</span>
            <div className="search-box">
              <span>🔍</span>
              <input
                placeholder="Tìm hãng, tên xe..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : (data?.data?.length ?? 0) === 0 ? (
              <div className="empty-state"><p>Không có mẫu xe nào</p></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Ảnh</th>
                    <th>Hãng</th>
                    <th>Tên mẫu</th>
                    <th>Loại</th>
                    <th>Màu sắc</th>
                    <th>Phiên bản</th>
                    <th>Pin / Tầm xa</th>
                    <th>Giá bán</th>
                    <th>BH</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map(v => (
                    <tr key={v.id}>
                      {/* Ảnh thumbnail */}
                      <td>
                        {v.image_url ? (
                          <img
                            src={v.image_url}
                            alt={v.model_name}
                            className="vm-thumb"
                            onClick={() => openDetail(v)}
                          />
                        ) : (
                          <div className="vm-thumb-ph" onClick={() => openDetail(v)}>🛵</div>
                        )}
                      </td>

                      <td className="fw-600">{v.brand}</td>
                      <td>
                        <span
                          className="vm-model-link"
                          onClick={() => openDetail(v)}
                        >{v.model_name}</span>
                        {v.is_active === false && (
                          <span className="badge badge-red" style={{ marginLeft: 6, fontSize: 10 }}>Ẩn</span>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: 11 }}>
                          {CATEGORY_LABEL[v.category ?? 'xe_may']}
                        </span>
                      </td>

                      {/* Màu sắc */}
                      <td>
                        <div className="vm-color-dots">
                          {(v.available_colors ?? []).slice(0, 5).map(c => (
                            <span
                              key={c}
                              className="vm-color-dot"
                              style={{ background: mauToHex(c) }}
                              title={c}
                            />
                          ))}
                          {(v.available_colors?.length ?? 0) > 5 && (
                            <span className="vm-color-more">+{(v.available_colors!.length) - 5}</span>
                          )}
                          {(v.available_colors?.length ?? 0) === 0 && (
                            <span className="text-muted" style={{ fontSize: 12 }}>—</span>
                          )}
                        </div>
                      </td>

                      {/* Phiên bản */}
                      <td>
                        {(v.variants?.length ?? 0) > 0 ? (
                          <span className="badge badge-purple" style={{ fontSize: 11 }}>
                            {v.variants!.length} phiên bản
                          </span>
                        ) : (
                          <span className="text-muted" style={{ fontSize: 12 }}>—</span>
                        )}
                      </td>

                      <td className="text-muted">
                        {v.battery_capacity_kwh ? `${v.battery_capacity_kwh} kWh` : (v.battery_capacity ?? '—')}
                        {(v.range_km ?? v.max_range) ? ` / ${v.range_km ?? v.max_range} km` : ''}
                      </td>
                      <td className="fw-600 text-primary">{formatCurrency(v.price_sell)}</td>
                      <td className="text-muted">{v.warranty_months}T</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {chiXem ? (
                            <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                          ) : (
                            <>
                              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(v)}>✏️</button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => { if (confirm(`Xoá mẫu xe "${v.model_name}"?`)) deleteMut.mutate(v.id); }}
                              >🗑️</button>
                            </>
                          )}
                        </div>
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
      </div>

      {/* ═══ MODAL TẠO / SỬA ═══ */}
      {(modal === 'create' || modal === 'edit') && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal vm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {modal === 'create' ? '➕ Thêm mẫu xe mới' : `✏️ Sửa: ${editing?.model_name}`}
              </span>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body vm-modal-body">

                {/* ── CỘT TRÁI ── */}
                <div className="vm-col">

                  {/* ─ Ảnh ─ */}
                  <div className="vm-section">
                    <div className="vm-section-title">🖼️ Hình ảnh</div>
                    <div
                      className={`vm-img-upload${imgUploading ? ' uploading' : ''}`}
                      onClick={() => !imgUploading && imgRef.current?.click()}
                    >
                      {imgUploading ? (
                        <div className="vm-img-empty">
                          <div className="spinner" />
                          <span>Đang upload...</span>
                        </div>
                      ) : form.image_url ? (
                        <img src={form.image_url} alt="preview" className="vm-img-preview" />
                      ) : (
                        <div className="vm-img-empty">
                          <span>📷</span>
                          <span>Click để chọn ảnh</span>
                          <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>PNG, JPG, WEBP — tối đa 5MB</span>
                        </div>
                      )}
                    </div>
                    <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />
                    {form.image_url && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <input
                          className="form-control"
                          style={{ fontSize: 12 }}
                          placeholder="Hoặc dán URL ảnh..."
                          value={form.image_url.startsWith('data:') ? '' : form.image_url}
                          onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))}
                        />
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(p => ({ ...p, image_url: '' }))}>✕</button>
                      </div>
                    )}
                    {!form.image_url && (
                      <input
                        className="form-control"
                        style={{ fontSize: 12, marginTop: 6 }}
                        placeholder="Hoặc dán URL ảnh..."
                        value={form.image_url}
                        onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* ─ Màu sắc ─ */}
                  <div className="vm-section">
                    <div className="vm-section-title">🎨 Màu sắc có sẵn</div>

                    {/* Gợi ý nhanh */}
                    <div className="vm-mau-goi-y">
                      {MAU_GOI_Y.map(m => (
                        <button
                          type="button"
                          key={m}
                          className={`vm-mau-chip${form.available_colors.includes(m) ? ' selected' : ''}`}
                          onClick={() => form.available_colors.includes(m) ? xoaMau(m) : themMau(m)}
                        >
                          <span className="vm-mau-dot" style={{ background: mauToHex(m) }} />
                          {m}
                        </button>
                      ))}
                    </div>

                    {/* Thêm màu tuỳ chỉnh */}
                    <div className="vm-mau-input-row">
                      <input
                        className="form-control"
                        placeholder="Thêm màu khác..."
                        value={inputMau}
                        onChange={e => setInputMau(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); themMau(inputMau); } }}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => themMau(inputMau)}>+ Thêm</button>
                    </div>

                    {/* Tags màu đã chọn */}
                    {form.available_colors.length > 0 && (
                      <div className="vm-mau-tags">
                        {form.available_colors.map(c => (
                          <span key={c} className="vm-mau-tag">
                            <span className="vm-mau-dot" style={{ background: mauToHex(c) }} />
                            {c}
                            <button type="button" onClick={() => xoaMau(c)}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ─ Phiên bản ─ */}
                  <div className="vm-section">
                    <div className="vm-section-title">📋 Phiên bản / Variant</div>
                    <div className="vm-variant-input-row">
                      <input
                        className="form-control"
                        placeholder="Tên phiên bản (VD: Cao Cấp)"
                        value={inputVariantTen}
                        onChange={e => setInputVariantTen(e.target.value)}
                        style={{ flex: 2 }}
                      />
                      <input
                        className="form-control"
                        placeholder="+/- giá (VD: 1000000)"
                        value={inputVariantGia}
                        onChange={e => setInputVariantGia(e.target.value)}
                        style={{ flex: 1.5 }}
                        type="number"
                      />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={themVariant}>+ Thêm</button>
                    </div>

                    {form.variants.length > 0 && (
                      <div className="vm-variant-list">
                        {form.variants.map(v => (
                          <div key={v.ten} className="vm-variant-row">
                            <span className="vm-variant-ten">{v.ten}</span>
                            <span className={`vm-variant-gia ${v.gia_chen_them >= 0 ? 'text-success' : 'text-danger'}`}>
                              {v.gia_chen_them === 0 ? 'Giá gốc' : (v.gia_chen_them > 0 ? '+' : '') + formatCurrency(v.gia_chen_them)}
                            </span>
                            <button type="button" className="vm-variant-del" onClick={() => xoaVariant(v.ten)}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── CỘT PHẢI ── */}
                <div className="vm-col">

                  {/* ─ Thông tin cơ bản ─ */}
                  <div className="vm-section">
                    <div className="vm-section-title">📋 Thông tin cơ bản</div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Hãng xe <span className="required">*</span></label>
                        <input className="form-control" required placeholder="VinFast, Yadea..." value={form.brand} onChange={f('brand')} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tên mẫu xe <span className="required">*</span></label>
                        <input className="form-control" required placeholder="Latte, VF 5..." value={form.model_name} onChange={f('model_name')} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Loại xe</label>
                        <select className="form-control" value={form.category} onChange={f('category')}>
                          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Bảo hành (tháng)</label>
                        <input className="form-control" type="number" min="0" value={form.warranty_months} onChange={f('warranty_months')} />
                      </div>
                    </div>
                  </div>

                  {/* ─ Thông số kỹ thuật ─ */}
                  <div className="vm-section">
                    <div className="vm-section-title">⚡ Thông số kỹ thuật</div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Dung lượng pin (kWh)</label>
                        <input className="form-control" type="number" step="0.01" min="0" placeholder="1.5" value={form.battery_capacity_kwh} onChange={f('battery_capacity_kwh')} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Loại pin</label>
                        <input className="form-control" placeholder="LFP, NMC, NCM..." value={form.battery_type} onChange={f('battery_type')} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tầm xa tối đa (km)</label>
                        <input className="form-control" type="number" min="0" placeholder="80" value={form.range_km} onChange={f('range_km')} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tốc độ tối đa (km/h)</label>
                        <input className="form-control" type="number" min="0" placeholder="45" value={form.max_speed_kmh} onChange={f('max_speed_kmh')} />
                      </div>
                    </div>
                  </div>

                  {/* ─ Giá ─ */}
                  <div className="vm-section">
                    <div className="vm-section-title">💰 Giá</div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Giá nhập (VNĐ) <span className="required">*</span></label>
                        <input className="form-control" type="number" min="0" required placeholder="0" value={form.price_cost} onChange={f('price_cost')} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Giá bán (VNĐ) <span className="required">*</span></label>
                        <input className="form-control" type="number" min="0" required placeholder="0" value={form.price_sell} onChange={f('price_sell')} />
                      </div>
                    </div>
                    {Number(form.price_cost) > 0 && Number(form.price_sell) > 0 && (
                      <div className="vm-margin-hint">
                        Biên lợi nhuận: <b style={{ color: Number(form.price_sell) >= Number(form.price_cost) ? 'var(--success)' : 'var(--danger)' }}>
                          {formatCurrency(Number(form.price_sell) - Number(form.price_cost))}
                        </b>
                        {' '}({((Number(form.price_sell) - Number(form.price_cost)) / Number(form.price_cost) * 100).toFixed(1)}%)
                      </div>
                    )}
                  </div>

                  {/* ─ Mô tả & Trạng thái ─ */}
                  <div className="vm-section">
                    <div className="form-group">
                      <label className="form-label">Mô tả</label>
                      <textarea className="form-control" rows={3} placeholder="Mô tả xe, tính năng nổi bật..." value={form.description} onChange={f('description')} />
                    </div>
                    <label className="vm-active-toggle">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                      />
                      <span>Đang kinh doanh (hiển thị trên POS)</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Huỷ</button>
                <button type="submit" className="btn btn-primary" disabled={createMut.isPending || updateMut.isPending || imgUploading}>
                  {imgUploading ? 'Đang upload ảnh...' : (createMut.isPending || updateMut.isPending) ? 'Đang lưu...' : (modal === 'create' ? 'Thêm mẫu xe' : 'Lưu thay đổi')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ MODAL CHI TIẾT ═══ */}
      {modal === 'detail' && editing && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🏍️ {editing.brand} {editing.model_name}</span>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="vm-detail-layout">
                {/* Ảnh */}
                <div className="vm-detail-img-wrap">
                  {editing.image_url ? (
                    <img src={editing.image_url} alt={editing.model_name} className="vm-detail-img" />
                  ) : (
                    <div className="vm-detail-img-ph">🛵</div>
                  )}
                </div>

                <div className="vm-detail-info">
                  <div className="vm-detail-price">{formatCurrency(editing.price_sell)}</div>
                  <div className="vm-detail-sub">Giá bán lẻ · BH {editing.warranty_months} tháng</div>

                  {/* Thông số */}
                  <div className="vm-detail-specs">
                    {[
                      ['Loại xe',   CATEGORY_LABEL[editing.category ?? 'xe_may']],
                      ['Dung lượng pin', editing.battery_capacity_kwh ? `${editing.battery_capacity_kwh} kWh` : (editing.battery_capacity ?? '—')],
                      ['Loại pin',  editing.battery_type ?? '—'],
                      ['Tầm xa',   editing.range_km ? `${editing.range_km} km` : '—'],
                      ['Tốc độ tối đa', editing.max_speed_kmh ? `${editing.max_speed_kmh} km/h` : '—'],
                      ['Giá nhập', formatCurrency(editing.price_cost)],
                    ].map(([k, v]) => (
                      <div key={k} className="vm-spec-row">
                        <span className="vm-spec-key">{k}</span>
                        <span className="vm-spec-val">{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Màu sắc + Mã sản phẩm */}
                  {(modelColors.length > 0 || (editing.available_colors?.length ?? 0) > 0 || !chiXem) && (
                    <div style={{ marginTop: 12 }}>
                      <div className="vm-section-title" style={{ fontSize: 12, marginBottom: 6 }}>
                        🎨 Màu sắc & Mã sản phẩm
                        {!chiXem && (
                          <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>
                            (gõ rồi Enter / rời ô để lưu)
                          </span>
                        )}
                      </div>
                      {modelColors.length > 0 ? (
                        <table className="table" style={{ fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 28 }} />
                              <th>Màu</th>
                              <th>Mã sản phẩm (SKU)</th>
                              {!chiXem && <th style={{ width: 40 }} />}
                            </tr>
                          </thead>
                          <tbody>
                            {modelColors.map(row => {
                              const editVal   = editingCodes[row.id];
                              const display   = editVal !== undefined ? editVal : (row.product_code ?? '');
                              const dirty     = editVal !== undefined && editVal !== (row.product_code ?? '');
                              const editName  = editingNames[row.id];
                              const dispName  = editName !== undefined ? editName : row.color_name;
                              const dirtyName = editName !== undefined && editName !== row.color_name;
                              return (
                                <tr key={row.id}>
                                  <td>
                                    <span
                                      className="vm-mau-dot"
                                      style={{ background: mauToHex(row.color_name, row.color_hex) }}
                                    />
                                  </td>
                                  <td>
                                    {chiXem ? (
                                      row.color_name
                                    ) : (
                                      <input
                                        className="form-control"
                                        style={{
                                          fontSize: 13, padding: '4px 8px',
                                          background: dirtyName ? '#fef9c3' : '#fff',
                                        }}
                                        value={dispName}
                                        disabled={updateColorMut.isPending}
                                        onChange={e => setEditingNames(prev => ({ ...prev, [row.id]: e.target.value }))}
                                        onBlur={() => luuTenMau(row)}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            luuTenMau(row);
                                          } else if (e.key === 'Escape') {
                                            setEditingNames(prev => {
                                              const { [row.id]: _omit, ...rest } = prev;
                                              return rest;
                                            });
                                          }
                                        }}
                                      />
                                    )}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                      <input
                                        className="form-control"
                                        style={{
                                          fontSize: 12, padding: '4px 8px',
                                          fontFamily: 'monospace',
                                          background: dirty ? '#fef9c3' : '#fff',
                                        }}
                                        placeholder="Để trống nếu chưa có"
                                        value={display}
                                        disabled={chiXem || updateColorMut.isPending}
                                        onChange={e => {
                                          const v = e.target.value.toUpperCase();
                                          setEditingCodes(prev => ({ ...prev, [row.id]: v }));
                                        }}
                                        onBlur={() => luuMaSP(row)}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            luuMaSP(row);
                                          } else if (e.key === 'Escape') {
                                            setEditingCodes(prev => {
                                              const { [row.id]: _omit, ...rest } = prev;
                                              return rest;
                                            });
                                          }
                                        }}
                                      />
                                      {dirty && (
                                        <span style={{ fontSize: 10, color: '#a16207' }}>
                                          chưa lưu
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  {!chiXem && (
                                    <td>
                                      <button
                                        type="button"
                                        className="btn btn-danger btn-sm"
                                        title="Xoá màu"
                                        disabled={deleteColorMut.isPending}
                                        onClick={() => xoaMauRow(row)}
                                        style={{ padding: '2px 8px', fontSize: 13 }}
                                      >🗑️</button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}

                            {/* Row thêm màu mới */}
                            {!chiXem && (
                              <tr style={{ background: '#f9fafb' }}>
                                <td>
                                  <span
                                    className="vm-mau-dot"
                                    style={{ background: newColorName.trim() ? mauToHex(newColorName.trim()) : '#e5e7eb' }}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="form-control"
                                    style={{ fontSize: 13, padding: '4px 8px' }}
                                    placeholder="Tên màu mới..."
                                    value={newColorName}
                                    disabled={addColorMut.isPending}
                                    onChange={e => setNewColorName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); themMauMoi(); }
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="form-control"
                                    style={{ fontSize: 12, padding: '4px 8px', fontFamily: 'monospace' }}
                                    placeholder="Mã SKU (tuỳ chọn)"
                                    value={newColorCode}
                                    disabled={addColorMut.isPending}
                                    onChange={e => setNewColorCode(e.target.value.toUpperCase())}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); themMauMoi(); }
                                    }}
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    title="Thêm màu"
                                    disabled={addColorMut.isPending || !newColorName.trim()}
                                    onClick={themMauMoi}
                                    style={{ padding: '2px 8px', fontSize: 13 }}
                                  >+</button>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <div className="vm-mau-tags" style={{ flexWrap: 'wrap' }}>
                          {(editing.available_colors ?? []).map(c => (
                            <span key={c} className="vm-mau-tag" style={{ cursor: 'default' }}>
                              <span className="vm-mau-dot" style={{ background: mauToHex(c) }} />
                              {c}
                            </span>
                          ))}
                          {(editing.available_colors?.length ?? 0) === 0 && !chiXem && (
                            <span className="text-muted" style={{ fontSize: 12 }}>
                              Chưa có màu — dùng nút "Chỉnh sửa" để thêm màu vào mẫu xe
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Phiên bản */}
                  {(editing.variants?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="vm-section-title" style={{ fontSize: 12, marginBottom: 6 }}>📋 Phiên bản</div>
                      {editing.variants!.map(v => (
                        <div key={v.ten} className="vm-variant-row" style={{ cursor: 'default' }}>
                          <span className="vm-variant-ten">{v.ten}</span>
                          <span className={`vm-variant-gia ${v.gia_chen_them >= 0 ? 'text-success' : 'text-danger'}`}>
                            {v.gia_chen_them === 0 ? formatCurrency(editing.price_sell) : formatCurrency(editing.price_sell + v.gia_chen_them)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {editing.description && (
                    <div style={{ marginTop: 12, fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                      {editing.description}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Đóng</button>
              <button className="btn btn-primary" onClick={() => openEdit(editing)}>✏️ Chỉnh sửa</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
