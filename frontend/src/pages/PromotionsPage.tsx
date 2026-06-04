// PromotionsPage.tsx — Quản lý Khuyến Mãi & Quà Tặng
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { Promotion, PromoStats, PromoUsage, PromoType, PromoAppliesTo, Accessory, VehicleModel } from '../types';

// ─── Màu dải gradient theo loại KM ──────────────────────────────────────────
const PROMO_GRADIENT: Record<PromoType, string> = {
  percent: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  fixed:   'linear-gradient(135deg, #10b981, #059669)',
  gift:    'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  combo:   'linear-gradient(135deg, #f59e0b, #d97706)',
};
void PROMO_GRADIENT;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n?: number | null) =>
  n != null ? n.toLocaleString('vi-VN') + ' ₫' : '—';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const isExpired  = (p: Promotion) => new Date(p.valid_until) < new Date();
const isNotStart = (p: Promotion) => new Date(p.valid_from)  > new Date();
const isExpiring = (p: Promotion) => {
  const diff = new Date(p.valid_until).getTime() - Date.now();
  return diff > 0 && diff < 7 * 24 * 3600 * 1000;
};

const PROMO_TYPE_LABEL: Record<PromoType, string> = {
  percent: '% Giảm giá',
  fixed:   'Giảm cố định',
  gift:    'Tặng quà',
  combo:   'Combo',
};
const PROMO_TYPE_COLOR: Record<PromoType, string> = {
  percent: 'badge-blue',
  fixed:   'badge-green',
  gift:    'badge-purple',
  combo:   'badge-orange',
};

// ─── Icon loại KM ────────────────────────────────────────────────────────────
const PROMO_TYPE_ICON: Record<PromoType, string> = {
  percent: '🏷️',
  fixed:   '💰',
  gift:    '🎁',
  combo:   '📦',
};
void PROMO_TYPE_ICON;

// ── Chip tabs loại KM ────────────────────────────────────────────────────────
const TYPE_CHIPS: { value: string; label: string; icon: string; activeColor: string }[] = [
  { value: '',        label: 'Tất cả',       icon: '📋', activeColor: '#2563eb' },
  { value: 'percent', label: '% Giảm giá',   icon: '🏷️', activeColor: '#2563eb' },
  { value: 'fixed',   label: 'Giảm cố định', icon: '💰', activeColor: '#059669' },
  { value: 'gift',    label: 'Tặng quà',     icon: '🎁', activeColor: '#7c3aed' },
  { value: 'combo',   label: 'Combo',        icon: '📦', activeColor: '#d97706' },
];

const BLANK_FORM = {
  promo_code:        '',
  name:              '',
  description:       '',
  promo_type:        'percent' as PromoType,
  discount_percent:  0,
  discount_amount:   0,
  min_order_amount:  0,
  max_discount_cap:  '',
  valid_from:        '',
  valid_until:       '',
  is_active:         true,
  usage_limit:       '',
  gift_item_id:      '',
  gift_quantity:     1,
  applicable_brands: '',
  applicable_models: [] as string[],   // [] = áp dụng cho mọi dòng xe
  applies_to:              'vehicle' as PromoAppliesTo,
  applicable_accessories:  [] as string[],   // [] = áp dụng cho mọi phụ kiện
  display_order:     '' as string | number,
  note:              '',
};

const APPLIES_TO_CHIPS: { value: PromoAppliesTo; label: string; icon: string; color: string }[] = [
  { value: 'vehicle',   label: 'Chỉ xe',           icon: '🏍️', color: '#2563eb' },
  { value: 'accessory', label: 'Chỉ phụ kiện',     icon: '🛍️', color: '#059669' },
  { value: 'both',      label: 'Cả xe & phụ kiện', icon: '📦', color: '#7c3aed' },
];

const APPLIES_TO_LABEL: Record<PromoAppliesTo, string> = {
  vehicle:   'Chỉ xe',
  accessory: 'Chỉ phụ kiện',
  both:      'Cả xe & phụ kiện',
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function PromotionsPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const chiXem = user?.role === 'sales';

  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatus]   = useState('all');
  const [page,       setPage]       = useState(1);

  const [modalOpen,  setModalOpen]  = useState(false);
  const [editData,   setEditData]   = useState<Promotion | null>(null);
  const [detailItem, setDetail]     = useState<Promotion | null>(null);
  const [form,       setForm]       = useState({ ...BLANK_FORM });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery<PromoStats>({
    queryKey: ['promo-stats'],
    queryFn: () => api.get('/promotions/stats').then(r => r.data),
    staleTime: 30000,
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ['promotions', search, typeFilter, statusFilter, page],
    queryFn: () =>
      api.get('/promotions', {
        params: {
          search:  search  || undefined,
          type:    typeFilter || undefined,
          status:  statusFilter,
          page, limit: 15,
        },
      }).then(r => r.data),
    staleTime: 15000,
  });

  const promos: Promotion[] = listData?.data ?? [];
  const total: number       = listData?.total ?? 0;
  const totalPages          = Math.max(1, Math.ceil(total / 15));

  const { data: detailFull, isLoading: loadingDetail } = useQuery({
    queryKey: ['promo-detail', detailItem?.id],
    queryFn: () => api.get(`/promotions/${detailItem!.id}`).then(r => r.data),
    enabled: !!detailItem,
  });

  const { data: giftData } = useQuery({
    queryKey: ['gift-items-dropdown'],
    queryFn: () => api.get('/inventory/gift-items', { params: { limit: 200 } }).then(r => r.data),
    staleTime: 60000,
  });
  const giftItems = giftData?.data ?? [];

  // Danh sách phụ kiện để chọn đích danh khi applies_to ≠ 'vehicle'
  const { data: accessoryData } = useQuery({
    queryKey: ['accessories-dropdown'],
    queryFn: () => api.get('/accessories', { params: { limit: 500 } }).then(r => r.data),
    staleTime: 60000,
  });
  const accessoryList: Accessory[] = accessoryData?.data ?? [];

  // Danh sách dòng xe để chọn áp dụng KM đích danh theo model
  const { data: modelData } = useQuery({
    queryKey: ['vehicle-models-dropdown'],
    queryFn: () => api.get('/vehicles', { params: { limit: 500 } }).then(r => r.data),
    staleTime: 60000,
  });
  const modelList: VehicleModel[] = modelData?.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['promotions'] });
    qc.invalidateQueries({ queryKey: ['promo-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/promotions', body).then(r => r.data),
    onSuccess: () => { toast.success('Đã tạo chương trình khuyến mãi'); closeModal(); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo khuyến mãi'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/promotions/${id}`, body).then(r => r.data),
    onSuccess: () => { toast.success('Đã cập nhật'); closeModal(); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật'),
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => api.patch(`/promotions/${id}/toggle`).then(r => r.data),
    onSuccess: (d) => {
      toast.success(d.is_active ? '✅ Đã kích hoạt' : '⏸ Đã tắt');
      invalidate();
      if (detailItem?.id === d.id) setDetail(prev => prev ? { ...prev, is_active: d.is_active } : prev);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi'),
  });

  const swapOrderMut = useMutation({
    mutationFn: ({ id, other_id }: { id: string; other_id: string }) =>
      api.patch(`/promotions/${id}/swap-order`, { other_id }).then(r => r.data),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi đổi thứ tự'),
  });

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const a = promos[idx];
    const b = promos[idx - 1];
    if (!a || !b) return;
    swapOrderMut.mutate({ id: a.id, other_id: b.id });
  };

  const moveDown = (idx: number) => {
    if (idx >= promos.length - 1) return;
    const a = promos[idx];
    const b = promos[idx + 1];
    if (!a || !b) return;
    swapOrderMut.mutate({ id: a.id, other_id: b.id });
  };

  // ── Helpers modal ──────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditData(null);
    setForm({ ...BLANK_FORM });
    setModalOpen(true);
  };

  const openEdit = (p: Promotion) => {
    setEditData(p);
    setForm({
      promo_code:        p.promo_code,
      name:              p.name,
      description:       p.description ?? '',
      promo_type:        p.promo_type,
      discount_percent:  p.discount_percent,
      discount_amount:   p.discount_amount,
      min_order_amount:  p.min_order_amount,
      max_discount_cap:  p.max_discount_cap != null ? String(p.max_discount_cap) : '',
      valid_from:        p.valid_from,
      valid_until:       p.valid_until,
      is_active:         p.is_active,
      usage_limit:       p.usage_limit != null ? String(p.usage_limit) : '',
      gift_item_id:      p.gift_item_id ?? '',
      gift_quantity:     p.gift_quantity ?? 1,
      applicable_brands: p.applicable_brands?.join(', ') ?? '',
      applicable_models: p.applicable_models ?? [],
      applies_to:              p.applies_to ?? 'vehicle',
      applicable_accessories:  p.applicable_accessories ?? [],
      display_order:     p.display_order != null ? String(p.display_order) : '',
      note:              p.note ?? '',
    });
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditData(null); };

  const setF = (k: keyof typeof BLANK_FORM, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = () => {
    const body = {
      ...form,
      max_discount_cap:  form.max_discount_cap  ? Number(form.max_discount_cap)  : null,
      usage_limit:       form.usage_limit        ? Number(form.usage_limit)        : null,
      applicable_brands: form.applicable_brands
        ? form.applicable_brands.split(',').map(s => s.trim()).filter(Boolean)
        : null,
      applicable_models: form.applicable_models.length ? form.applicable_models : null,
      // applies_to = 'vehicle' → bỏ qua applicable_accessories
      // applicable_accessories rỗng = áp dụng cho mọi phụ kiện trong giỏ
      applicable_accessories: form.applies_to === 'vehicle'
        ? null
        : (form.applicable_accessories.length ? form.applicable_accessories : null),
      gift_item_id: form.gift_item_id || null,
      display_order: form.display_order === '' ? null : Number(form.display_order),
    };
    if (editData) updateMut.mutate({ id: editData.id, body });
    else          createMut.mutate(body);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  // ── Tính toán hiển thị ────────────────────────────────────────────────────
  const usageHistory: PromoUsage[] = detailFull?.usage_history ?? [];

  const progressPct = useMemo(() => {
    if (!detailFull) return 0;
    if (!detailFull.usage_limit) return 0;
    return Math.min(100, Math.round((detailFull.usage_count / detailFull.usage_limit) * 100));
  }, [detailFull]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* ══ TIÊU ĐỀ ══ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🎉 Khuyến Mãi & Quà Tặng</h1>
          <p className="page-subtitle">Quản lý chương trình khuyến mãi, chiết khấu và quà tặng kèm</p>
        </div>
        {!chiXem && (
          <button className="btn btn-primary" onClick={openCreate}>
            + Tạo chương trình
          </button>
        )}
      </div>

      {/* ══ STAT CARDS ══ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--gray-500)' }}>Tổng</span>
          <span style={{ fontWeight: 700, color: 'var(--gray-800)' }}>{stats?.total ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
          <span style={{ color: 'var(--gray-500)' }}>Đang chạy</span>
          <span style={{ fontWeight: 700, color: '#16a34a' }}>{stats?.active ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706', flexShrink: 0 }} />
          <span style={{ color: 'var(--gray-500)' }}>Sắp hết hạn</span>
          <span style={{ fontWeight: 700, color: '#d97706' }}>{stats?.expiring_soon ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--gray-500)' }}>Chiết khấu đã dùng</span>
          <span style={{ fontWeight: 700, color: 'var(--gray-800)' }}>{fmt(stats?.total_discount)}</span>
        </div>
      </div>

      {/* ══ BẢNG DANH SÁCH ══ */}
      <div className="card">
        <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          {/* Hàng 1: search + trạng thái */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="search-box" style={{ flex: 1, minWidth: 180 }}>
              <input
                placeholder="Tìm tên, mã KM..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select className="filter-select" value={statusFilter}
              onChange={e => { setStatus(e.target.value); setPage(1); }}>
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Đã tắt</option>
              <option value="expired">Đã hết hạn</option>
            </select>
          </div>
          {/* Hàng 2: chip tabs loại KM */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TYPE_CHIPS.map(chip => {
              const isActive = typeFilter === chip.value;
              return (
                <button
                  type="button"
                  key={chip.value}
                  onClick={() => { setTypeFilter(chip.value); setPage(1); }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: `1px solid ${isActive ? chip.activeColor : 'var(--gray-300)'}`,
                    background: isActive ? chip.activeColor : 'white',
                    color: isActive ? 'white' : 'var(--gray-700)',
                    fontWeight: isActive ? 600 : 400,
                    transition: 'all .15s',
                  }}
                >
                  {chip.icon} {chip.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="table-wrap">
        <table className="table mobile-cards">
          <thead>
            <tr>
              <th>Mã KM</th>
              <th>Tên chương trình</th>
              <th>Loại</th>
              <th>Ưu đãi</th>
              <th className="hide-mobile">Hiệu lực</th>
              <th className="hide-mobile" style={{ textAlign: 'center' }}>Lượt dùng</th>
              <th style={{ textAlign: 'center' }}>Trạng thái</th>
              <th style={{ textAlign: 'center' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" />
              </td></tr>
            ) : promos.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                Chưa có chương trình khuyến mãi nào
              </td></tr>
            ) : promos.map((p, idx) => {
              const expired   = isExpired(p);
              const notStart  = isNotStart(p);
              const expiring  = isExpiring(p);

              let statusBadge = <span className="badge badge-green">Đang chạy</span>;
              if (!p.is_active)  statusBadge = <span className="badge badge-gray">Đã tắt</span>;
              else if (expired)  statusBadge = <span className="badge badge-red">Hết hạn</span>;
              else if (notStart) statusBadge = <span className="badge badge-blue">Chưa bắt đầu</span>;
              else if (expiring) statusBadge = <span className="badge badge-orange">Sắp hết hạn</span>;

              return (
                <tr key={p.id} style={{ cursor: 'pointer' }}
                  onClick={() => setDetail(p)}>
                  <td data-label="Mã KM"><span className="font-mono text-primary">{p.promo_code}</span></td>
                  <td data-label="Tên chương trình">
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    {p.min_order_amount > 0 && (
                      <div style={{ fontSize: 12, color: '#888' }}>
                        Đơn tối thiểu: {fmt(p.min_order_amount)}
                      </div>
                    )}
                  </td>
                  <td data-label="Loại">
                    <span className={`badge ${PROMO_TYPE_COLOR[p.promo_type]}`}>
                      {PROMO_TYPE_LABEL[p.promo_type]}
                    </span>
                  </td>
                  <td data-label="Ưu đãi">
                    {p.promo_type === 'percent' && (
                      <span style={{ fontWeight: 700, color: '#e53e3e' }}>
                        -{p.discount_percent}%
                        {p.max_discount_cap && (
                          <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>
                            {' '}(tối đa {fmt(p.max_discount_cap)})
                          </span>
                        )}
                      </span>
                    )}
                    {p.promo_type === 'fixed' && (
                      <span style={{ fontWeight: 700, color: '#e53e3e' }}>
                        -{fmt(p.discount_amount)}
                      </span>
                    )}
                    {(p.promo_type === 'gift' || p.promo_type === 'combo') && (
                      <span style={{ color: '#805ad5' }}>
                        🎁 {p.gift_items?.name ?? 'Quà tặng'} ×{p.gift_quantity}
                      </span>
                    )}
                  </td>
                  <td data-label="Hiệu lực" className="hide-mobile" style={{ fontSize: 13 }}>
                    <div>{fmtDate(p.valid_from)}</div>
                    <div style={{ color: '#888' }}>→ {fmtDate(p.valid_until)}</div>
                  </td>
                  <td data-label="Lượt dùng" className="hide-mobile" style={{ textAlign: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{p.usage_count}</span>
                    {p.usage_limit && (
                      <span style={{ color: '#888', fontSize: 12 }}>/{p.usage_limit}</span>
                    )}
                  </td>
                  <td data-label="Trạng thái" style={{ textAlign: 'center' }}>{statusBadge}</td>
                  <td data-label="Thao tác" style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      {chiXem ? (
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                      ) : (
                        <>
                          <button
                            className="btn btn-sm btn-outline"
                            title="Lên trên"
                            disabled={idx === 0 || swapOrderMut.isPending}
                            onClick={() => moveUp(idx)}
                            style={{ padding: '2px 6px' }}
                          >↑</button>
                          <button
                            className="btn btn-sm btn-outline"
                            title="Xuống dưới"
                            disabled={idx === promos.length - 1 || swapOrderMut.isPending}
                            onClick={() => moveDown(idx)}
                            style={{ padding: '2px 6px' }}
                          >↓</button>
                          <button className="btn btn-sm btn-outline" onClick={() => openEdit(p)}>✏️</button>
                          <button
                            className={`btn btn-sm ${p.is_active ? 'btn-warning' : 'btn-success'}`}
                            onClick={() => toggleMut.mutate(p.id)}
                            disabled={toggleMut.isPending}
                          >
                            {p.is_active ? '⏸' : '▶️'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="pagination" style={{ marginTop: 12 }}>
          <button className="btn btn-sm btn-outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
          <span style={{ padding: '0 12px', fontSize: 14 }}>Trang {page}/{totalPages}</span>
          <button className="btn btn-sm btn-outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
        </div>
      )}

      {/* ══ MODAL TẠO / SỬA ══ */}
      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {editData ? '✏️ Sửa chương trình' : '+ Tạo chương trình khuyến mãi'}
              </span>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>

              <div className="form-grid">
                {/* Tên */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Tên chương trình <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.name} onChange={e => setF('name', e.target.value)}
                    placeholder="VD: Khuyến mãi tháng 6 — Giảm 5%" />
                </div>

                {/* Loại */}
                <div className="form-group">
                  <label className="form-label">Loại khuyến mãi</label>
                  <select className="form-control" value={form.promo_type}
                    onChange={e => setF('promo_type', e.target.value as PromoType)}>
                    <option value="percent">% Giảm giá</option>
                    <option value="fixed">Giảm tiền cố định</option>
                    <option value="gift">Tặng quà kèm</option>
                    <option value="combo">Combo ưu đãi</option>
                  </select>
                </div>

                {/* Mã KM */}
                <div className="form-group">
                  <label className="form-label">Mã KM <span style={{ color: '#888', fontWeight: 400 }}>(để trống = tự sinh)</span></label>
                  <input className="form-control" value={form.promo_code}
                    onChange={e => setF('promo_code', e.target.value.toUpperCase())}
                    placeholder="KM202601001" />
                </div>

                {/* Ưu đãi theo loại */}
                {form.promo_type === 'percent' && (<>
                  <div className="form-group">
                    <label className="form-label">Phần trăm giảm (%) <span className="text-danger">*</span></label>
                    <input className="form-control" type="number" min={1} max={100}
                      value={form.discount_percent}
                      onChange={e => setF('discount_percent', Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Trần giảm tối đa (₫)</label>
                    <input className="form-control" type="number" min={0}
                      value={form.max_discount_cap}
                      onChange={e => setF('max_discount_cap', e.target.value)}
                      placeholder="Để trống = không giới hạn" />
                  </div>
                </>)}

                {form.promo_type === 'fixed' && (
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label className="form-label">Số tiền giảm (₫) <span className="text-danger">*</span></label>
                    <input className="form-control" type="number" min={1}
                      value={form.discount_amount}
                      onChange={e => setF('discount_amount', Number(e.target.value))} />
                  </div>
                )}

                {(form.promo_type === 'gift' || form.promo_type === 'combo') && (<>
                  <div className="form-group">
                    <label className="form-label">Quà tặng kèm <span className="text-danger">*</span></label>
                    <select className="form-control" value={form.gift_item_id}
                      onChange={e => setF('gift_item_id', e.target.value)}>
                      <option value="">-- Chọn quà tặng --</option>
                      {giftItems.map((g: any) => (
                        <option key={g.id} value={g.id}>{g.name} (còn: {g.qty_in_stock})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Số lượng quà</label>
                    <input className="form-control" type="number" min={1}
                      value={form.gift_quantity}
                      onChange={e => setF('gift_quantity', Number(e.target.value))} />
                  </div>
                  {form.promo_type === 'combo' && (
                    <div className="form-group" style={{ gridColumn: '1/-1' }}>
                      <label className="form-label">Số tiền giảm thêm (₫)</label>
                      <input className="form-control" type="number" min={0}
                        value={form.discount_amount}
                        onChange={e => setF('discount_amount', Number(e.target.value))}
                        placeholder="Để 0 nếu chỉ tặng quà" />
                    </div>
                  )}
                </>)}

                {/* Điều kiện */}
                <div className="form-group">
                  <label className="form-label">Đơn hàng tối thiểu (₫)</label>
                  <input className="form-control" type="number" min={0}
                    value={form.min_order_amount}
                    onChange={e => setF('min_order_amount', Number(e.target.value))} />
                </div>

                <div className="form-group">
                  <label className="form-label">Giới hạn lượt dùng</label>
                  <input className="form-control" type="number" min={1}
                    value={form.usage_limit}
                    onChange={e => setF('usage_limit', e.target.value)}
                    placeholder="Để trống = không giới hạn" />
                </div>

                <div className="form-group">
                  <label className="form-label">Thứ tự hiển thị trong POS
                    <span style={{ color: '#888', fontWeight: 400 }}> (số nhỏ hiện trước)</span>
                  </label>
                  <input className="form-control" type="number"
                    value={form.display_order}
                    onChange={e => setF('display_order', e.target.value)}
                    placeholder="Để trống = cuối danh sách" />
                </div>

                {/* Hiệu lực */}
                <div className="form-group">
                  <label className="form-label">Ngày bắt đầu <span className="text-danger">*</span></label>
                  <input className="form-control" type="date" value={form.valid_from}
                    onChange={e => setF('valid_from', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Ngày kết thúc <span className="text-danger">*</span></label>
                  <input className="form-control" type="date" value={form.valid_until}
                    onChange={e => setF('valid_until', e.target.value)} />
                </div>

                {/* Hãng xe áp dụng */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Hãng xe áp dụng
                    <span style={{ color: '#888', fontWeight: 400 }}> (phân cách bằng dấu phẩy, để trống = tất cả)</span>
                  </label>
                  <input className="form-control" value={form.applicable_brands}
                    onChange={e => setF('applicable_brands', e.target.value)}
                    placeholder="VD: VinFast, Yamaha, Honda" />
                </div>

                {/* Dòng xe áp dụng — chọn đích danh từng model */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">
                    Dòng xe áp dụng
                    <span style={{ color: '#888', fontWeight: 400 }}>
                      {' '}({form.applicable_models.length === 0
                        ? 'tất cả dòng xe'
                        : `đã chọn ${form.applicable_models.length} dòng`})
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => setF('applicable_models', [])}
                    >
                      Áp dụng tất cả
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => setF('applicable_models', modelList.map(m => m.id))}
                    >
                      Chọn hết
                    </button>
                  </div>
                  <div style={{
                    maxHeight: 200, overflowY: 'auto',
                    border: '1px solid var(--gray-200)', borderRadius: 6,
                    padding: 8, background: '#fafafa',
                  }}>
                    {modelList.length === 0 ? (
                      <div style={{ color: '#888', textAlign: 'center', padding: 12, fontSize: 13 }}>
                        Chưa có dòng xe
                      </div>
                    ) : modelList.map(m => {
                      const checked = form.applicable_models.includes(m.id);
                      return (
                        <label key={m.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '4px 6px', cursor: 'pointer', fontSize: 13,
                        }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setF('applicable_models',
                                checked
                                  ? form.applicable_models.filter(id => id !== m.id)
                                  : [...form.applicable_models, m.id]);
                            }}
                          />
                          <span>🛵 <b>{m.brand}</b> {m.model_name}</span>
                          {m.price_sell && (
                            <span style={{ color: '#888', marginLeft: 'auto' }}>
                              {fmt(m.price_sell)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Phạm vi áp dụng — chỉ cho percent / fixed (gift/combo luôn là tặng kèm xe) */}
                {(form.promo_type === 'percent' || form.promo_type === 'fixed') && (
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label className="form-label">
                      Phạm vi giảm giá
                      <span style={{ color: '#888', fontWeight: 400 }}> (giảm trên xe, phụ kiện hay cả hai)</span>
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {APPLIES_TO_CHIPS.map(chip => {
                        const active = form.applies_to === chip.value;
                        return (
                          <button
                            type="button"
                            key={chip.value}
                            onClick={() => setF('applies_to', chip.value)}
                            style={{
                              padding: '6px 14px', borderRadius: 20, fontSize: 13,
                              cursor: 'pointer',
                              border: `1.5px solid ${active ? chip.color : 'var(--gray-300)'}`,
                              background: active ? chip.color : 'white',
                              color: active ? 'white' : 'var(--gray-700)',
                              fontWeight: active ? 600 : 400,
                            }}
                          >
                            {chip.icon} {chip.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Chọn phụ kiện đích danh — chỉ hiện khi accessory/both */}
                {(form.promo_type === 'percent' || form.promo_type === 'fixed') &&
                 (form.applies_to === 'accessory' || form.applies_to === 'both') && (
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label className="form-label">
                      Phụ kiện áp dụng
                      <span style={{ color: '#888', fontWeight: 400 }}>
                        {' '}({form.applicable_accessories.length === 0
                          ? 'đang áp dụng tất cả phụ kiện trong giỏ'
                          : `đã chọn ${form.applicable_accessories.length}`})
                      </span>
                    </label>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => setF('applicable_accessories', [])}
                      >
                        Áp dụng tất cả
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => setF('applicable_accessories', accessoryList.map(a => a.id))}
                      >
                        Chọn hết
                      </button>
                    </div>
                    <div style={{
                      maxHeight: 200, overflowY: 'auto',
                      border: '1px solid var(--gray-200)', borderRadius: 6,
                      padding: 8, background: '#fafafa',
                    }}>
                      {accessoryList.length === 0 ? (
                        <div style={{ color: '#888', textAlign: 'center', padding: 12, fontSize: 13 }}>
                          Chưa có phụ kiện
                        </div>
                      ) : accessoryList.map(a => {
                        const checked = form.applicable_accessories.includes(a.id);
                        return (
                          <label key={a.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '4px 6px', cursor: 'pointer', fontSize: 13,
                          }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => {
                                const next = e.target.checked
                                  ? [...form.applicable_accessories, a.id]
                                  : form.applicable_accessories.filter(x => x !== a.id);
                                setF('applicable_accessories', next);
                              }}
                            />
                            <span style={{ flex: 1 }}>{a.name}</span>
                            <span className="font-mono" style={{ color: '#888', fontSize: 11 }}>{a.code}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Mô tả */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Mô tả chương trình</label>
                  <textarea className="form-control" rows={2} value={form.description}
                    onChange={e => setF('description', e.target.value)}
                    placeholder="Mô tả ngắn hiển thị cho nhân viên bán hàng" />
                </div>

                {/* Ghi chú nội bộ */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Ghi chú nội bộ</label>
                  <textarea className="form-control" rows={2} value={form.note}
                    onChange={e => setF('note', e.target.value)}
                    placeholder="Điều kiện đặc biệt, nguồn ngân sách..." />
                </div>

                {/* Kích hoạt */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_active}
                      onChange={e => setF('is_active', e.target.checked)} />
                    <span>Kích hoạt ngay sau khi tạo</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>Hủy</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
                {isPending ? 'Đang lưu...' : editData ? 'Cập nhật' : 'Tạo chương trình'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CHI TIẾT ══ */}
      {detailItem && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🎉 {detailItem.name}
                <span className="font-mono" style={{ fontSize: 13, marginLeft: 10, color: '#888' }}>
                  {detailItem.promo_code}
                </span>
              </span>
              <button className="modal-close" onClick={() => setDetail(null)}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

              {loadingDetail ? (
                <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
              ) : detailFull && (<>

                {/* Thông tin chính */}
                <div className="order-detail-grid" style={{ marginBottom: 16 }}>
                  <div className="order-detail-col">
                    <div className="order-detail-item">
                      <span className="order-detail-label">Loại</span>
                      <span className={`badge ${(PROMO_TYPE_COLOR as Record<string, string>)[detailFull.promo_type] ?? 'badge-gray'}`}>
                        {(PROMO_TYPE_LABEL as Record<string, string>)[detailFull.promo_type] ?? detailFull.promo_type}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Ưu đãi</span>
                      <span className="order-detail-val" style={{ color: '#e53e3e', fontWeight: 700 }}>
                        {detailFull.promo_type === 'percent'
                          ? `-${detailFull.discount_percent}%${detailFull.max_discount_cap ? ` (tối đa ${fmt(detailFull.max_discount_cap)})` : ''}`
                          : detailFull.promo_type === 'fixed'
                          ? `-${fmt(detailFull.discount_amount)}`
                          : `🎁 ${detailFull.gift_items?.name ?? '—'} ×${detailFull.gift_quantity}`}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Đơn tối thiểu</span>
                      <span className="order-detail-val">{fmt(detailFull.min_order_amount)}</span>
                    </div>
                  </div>
                  <div className="order-detail-col">
                    <div className="order-detail-item">
                      <span className="order-detail-label">Hiệu lực</span>
                      <span className="order-detail-val">
                        {fmtDate(detailFull.valid_from)} → {fmtDate(detailFull.valid_until)}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Hãng áp dụng</span>
                      <span className="order-detail-val">
                        {detailFull.applicable_brands?.join(', ') || 'Tất cả'}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Dòng xe áp dụng</span>
                      <span className="order-detail-val">
                        {detailFull.applicable_models?.length
                          ? modelList
                              .filter(m => detailFull.applicable_models!.includes(m.id))
                              .map(m => `${m.brand} ${m.model_name}`)
                              .join(', ') || `${detailFull.applicable_models.length} dòng`
                          : 'Tất cả'}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Phạm vi giảm</span>
                      <span className="order-detail-val">
                        {APPLIES_TO_LABEL[(detailFull.applies_to ?? 'vehicle') as PromoAppliesTo]}
                        {(detailFull.applies_to === 'accessory' || detailFull.applies_to === 'both') && (
                          <span style={{ color: '#888', fontSize: 12, marginLeft: 6 }}>
                            ({detailFull.applicable_accessories?.length
                              ? `${detailFull.applicable_accessories.length} phụ kiện đích danh`
                              : 'mọi phụ kiện trong đơn'})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Người tạo</span>
                      <span className="order-detail-val">{detailFull.users?.full_name ?? '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Thanh tiến độ */}
                {detailFull.usage_limit && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>Lượt đã dùng</span>
                      <span>{detailFull.usage_count} / {detailFull.usage_limit} ({progressPct}%)</span>
                    </div>
                    <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${progressPct}%`,
                        background: progressPct >= 90 ? '#e53e3e' : progressPct >= 70 ? '#ed8936' : '#48bb78',
                        borderRadius: 4, transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                )}

                {detailFull.description && (
                  <div style={{ background: '#f7fafc', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                    <p style={{ margin: 0, color: '#4a5568' }}>{detailFull.description}</p>
                  </div>
                )}

                {/* Lịch sử sử dụng */}
                <p className="form-section-title">📊 Lịch sử sử dụng ({usageHistory.length})</p>
                {usageHistory.length === 0 ? (
                  <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>Chưa có lượt nào</p>
                ) : (
                  <table className="table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Đơn hàng</th>
                        <th>Khách hàng</th>
                        <th>Ngày áp dụng</th>
                        <th style={{ textAlign: 'right' }}>Chiết khấu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageHistory.map(u => (
                        <tr key={u.id}>
                          <td><span className="font-mono text-primary">{u.sales_orders?.order_number ?? '—'}</span></td>
                          <td>{u.sales_orders?.customers?.full_name ?? '—'}</td>
                          <td>{fmtDate(u.created_at)}</td>
                          <td style={{ textAlign: 'right', color: '#e53e3e', fontWeight: 600 }}>
                            -{fmt(u.discount_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>)}
            </div>
            <div className="modal-footer">
              {!chiXem && (
                <>
                  <button className="btn btn-outline" onClick={() => { setDetail(null); openEdit(detailItem); }}>
                    ✏️ Sửa
                  </button>
                  <button
                    className={`btn ${detailItem.is_active ? 'btn-warning' : 'btn-success'}`}
                    onClick={() => toggleMut.mutate(detailItem.id)}
                    disabled={toggleMut.isPending}
                  >
                    {detailItem.is_active ? '⏸ Tắt chương trình' : '▶️ Kích hoạt'}
                  </button>
                </>
              )}
              <button className="btn btn-outline" onClick={() => setDetail(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
