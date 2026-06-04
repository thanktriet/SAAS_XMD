import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useUploadImage } from '../hooks/useUploadImage';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface GiftItem {
  id: string;
  code: string;
  name: string;
  category?: string;
  unit: string;
  qty_in_stock: number;
  qty_minimum: number;
  price_cost: number;
  valid_from?: string;
  valid_until?: string;
  note?: string;
  is_active: boolean;
  display_order?: number | null;
  created_at: string;
}

interface Movement {
  id: string;
  movement_type: string;
  quantity: number;       // dương = nhập vào, âm = xuất ra
  unit_cost: number;
  order_id?: string | null;
  reference_code?: string | null;
  supplier?: string | null;
  note?: string | null;
  created_at: string;
  users?: { full_name: string } | null;
  sales_orders?: { order_number: string } | null;
}

interface GiftForm {
  name: string;
  category: string;
  unit: string;
  qty_minimum: number;
  price_cost: number;
  valid_from: string;
  valid_until: string;
  note: string;
  image_url: string;
  display_order: string;
}

type ErrAxios = { response?: { data?: { error?: string } } };

// ─── Hằng số ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'mu_bao_hiem',
  'ao_mua',
  'tui_xe',
  'phieu_dich_vu',
  'voucher_giam_gia',
  'qua_tang_khac',
];

const CATEGORY_LABELS: Record<string, string> = {
  mu_bao_hiem: 'Mũ bảo hiểm',
  ao_mua: 'Áo mưa',
  tui_xe: 'Túi xe',
  phieu_dich_vu: 'Phiếu dịch vụ',
  voucher_giam_gia: 'Voucher giảm giá',
  qua_tang_khac: 'Quà tặng khác',
};

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  import:           { label: 'Nhập kho',       color: '#16a34a' },
  export_gift:      { label: 'Phát tặng',       color: '#7c3aed' },
  export_sale:      { label: 'Xuất bán',        color: '#d97706' },
  export_warranty:  { label: 'Xuất bảo hành',  color: '#0369a1' },
  adjust_plus:      { label: 'Điều chỉnh +',   color: '#2563eb' },
  adjust_minus:     { label: 'Điều chỉnh -',   color: '#dc2626' },
  return:           { label: 'Trả NCC',         color: '#6b7280' },
};

const DEFAULT_FORM: GiftForm = {
  name: '',
  category: '',
  unit: 'cái',
  qty_minimum: 0,
  price_cost: 0,
  valid_from: '',
  valid_until: '',
  note: '',
  image_url: '',
  display_order: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtSo = (n: number) => (n ?? 0).toLocaleString('vi-VN');
const fmtNgay = (s?: string) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—');
const fmtTien = (n: number) =>
  (n ?? 0).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });

function badgeHieuLuc(item: GiftItem) {
  if (!item.valid_from && !item.valid_until) {
    return (
      <span
        style={{
          background: '#f3f4f6',
          color: '#6b7280',
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        Chưa xác định
      </span>
    );
  }
  const now = new Date();
  const until = item.valid_until ? new Date(item.valid_until) : null;
  const conHan = !until || until >= now;
  return (
    <span
      style={{
        background: conHan ? '#dcfce7' : '#fee2e2',
        color: conHan ? '#16a34a' : '#dc2626',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {conHan ? 'Còn hiệu lực' : 'Hết hạn'}
    </span>
  );
}

// ─── Component chính ──────────────────────────────────────────────────────────

export default function GiftsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const laSales   = user?.role === 'sales';
  const laManager = user?.role === 'manager';
  // Sales: chỉ xem; Manager: nhập/xuất được, không sửa/thêm
  const khongDuocSua  = laSales || laManager;
  const khongDuocThem = laSales || laManager;
  const khongDuocXuatNhap = laSales;

  // Bộ lọc
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Modal state
  const [modalThem, setModalThem] = useState(false);
  const [modalSua, setModalSua] = useState<GiftItem | null>(null);
  const [modalNhap, setModalNhap] = useState<GiftItem | null>(null);
  const [modalPhat, setModalPhat] = useState<GiftItem | null>(null);
  const [modalLichSu, setModalLichSu] = useState<GiftItem | null>(null);

  // Form tạo/sửa
  const [form, setForm] = useState<GiftForm>(DEFAULT_FORM);
  const { uploading: imgUploading, upload: uploadImg } = useUploadImage({
    bucket: 'vehicle-images',
    folder: 'gifts',
  });

  // Form nhập kho
  const [nhapSoLuong, setNhapSoLuong] = useState('');
  const [nhapDonGia, setNhapDonGia] = useState('');
  const [nhapGhiChu, setNhapGhiChu] = useState('');

  // Form phát quà
  const [phatSoLuong, setPhatSoLuong] = useState('');
  const [phatMaDon, setPhatMaDon] = useState('');
  const [phatGhiChu, setPhatGhiChu] = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: listData, isLoading } = useQuery({
    queryKey: ['gift-items', search, filterCategory],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCategory) params.set('category', filterCategory);
      params.set('limit', '200');
      const res = await api.get(`/inventory/gift-items?${params.toString()}`);
      return res.data as { data: GiftItem[]; total: number };
    },
  });

  const { data: movementsData, isLoading: loadingMovements } = useQuery({
    queryKey: ['gift-movements', modalLichSu?.id],
    queryFn: async () => {
      const res = await api.get(`/inventory/gift-items/${modalLichSu!.id}/movements`);
      return res.data as { data: Movement[]; total: number };
    },
    enabled: !!modalLichSu,
  });

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const mutThem = useMutation({
    mutationFn: (body: GiftForm) => api.post('/inventory/gift-items', {
      ...body,
      display_order: body.display_order === '' ? null : Number(body.display_order),
    }),
    onSuccess: () => {
      toast.success('Thêm quà tặng thành công');
      queryClient.invalidateQueries({ queryKey: ['gift-items'] });
      setModalThem(false);
      setForm(DEFAULT_FORM);
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Thêm thất bại');
    },
  });

  const mutSua = useMutation({
    mutationFn: (body: GiftForm) => api.put(`/inventory/gift-items/${modalSua!.id}`, {
      ...body,
      display_order: body.display_order === '' ? null : Number(body.display_order),
    }),
    onSuccess: () => {
      toast.success('Cập nhật thành công');
      queryClient.invalidateQueries({ queryKey: ['gift-items'] });
      setModalSua(null);
      setForm(DEFAULT_FORM);
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Cập nhật thất bại');
    },
  });

  const mutSwapOrder = useMutation({
    mutationFn: ({ id, other_id }: { id: string; other_id: string }) =>
      api.patch(`/inventory/gift-items/${id}/swap-order`, { other_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gift-items'] });
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Đổi thứ tự thất bại');
    },
  });

  const mutNhap = useMutation({
    mutationFn: () =>
      api.post(`/inventory/gift-items/${modalNhap!.id}/stock-in`, {
        quantity: Number(nhapSoLuong),
        unit_cost: Number(nhapDonGia),
        note: nhapGhiChu,
      }),
    onSuccess: () => {
      toast.success('Nhập kho thành công');
      queryClient.invalidateQueries({ queryKey: ['gift-items'] });
      setModalNhap(null);
      setNhapSoLuong('');
      setNhapDonGia('');
      setNhapGhiChu('');
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Nhập kho thất bại');
    },
  });

  const mutPhat = useMutation({
    mutationFn: () =>
      api.post(`/inventory/gift-items/${modalPhat!.id}/stock-out`, {
        quantity: Number(phatSoLuong),
        order_id: phatMaDon || undefined,
        note: phatGhiChu,
      }),
    onSuccess: () => {
      toast.success('Phát quà thành công');
      queryClient.invalidateQueries({ queryKey: ['gift-items'] });
      setModalPhat(null);
      setPhatSoLuong('');
      setPhatMaDon('');
      setPhatGhiChu('');
    },
    onError: (err: ErrAxios) => {
      toast.error(err.response?.data?.error ?? 'Phát quà thất bại');
    },
  });

  // ─── Dữ liệu thống kê ────────────────────────────────────────────────────────

  const danhSach: GiftItem[] = listData?.data ?? [];
  const tongLoai = danhSach.length;
  const hetHang = danhSach.filter((x) => x.qty_in_stock === 0).length;
  const sapHet = danhSach.filter(
    (x) => x.qty_in_stock > 0 && x.qty_in_stock <= x.qty_minimum,
  ).length;

  // ─── Handlers modal tạo/sửa ──────────────────────────────────────────────────

  function moModalThem() {
    setForm(DEFAULT_FORM);
    setModalThem(true);
  }

  function moModalSua(item: GiftItem) {
    setForm({
      name: item.name,
      category: item.category ?? '',
      unit: item.unit,
      qty_minimum: item.qty_minimum,
      price_cost: item.price_cost,
      valid_from: item.valid_from ? item.valid_from.slice(0, 10) : '',
      valid_until: item.valid_until ? item.valid_until.slice(0, 10) : '',
      note: item.note ?? '',
      image_url: (item as { image_url?: string }).image_url ?? '',
      display_order: item.display_order != null ? String(item.display_order) : '',
    });
    setModalSua(item);
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Vui lòng nhập tên quà tặng');
      return;
    }
    if (modalSua) {
      mutSua.mutate(form);
    } else {
      mutThem.mutate(form);
    }
  }

  // ─── Handler nhập kho ────────────────────────────────────────────────────────

  function submitNhap(e: React.FormEvent) {
    e.preventDefault();
    const sl = Number(nhapSoLuong);
    if (!sl || sl <= 0) {
      toast.error('Số lượng nhập phải lớn hơn 0');
      return;
    }
    mutNhap.mutate();
  }

  // ─── Handler phát quà ────────────────────────────────────────────────────────

  function submitPhat(e: React.FormEvent) {
    e.preventDefault();
    const sl = Number(phatSoLuong);
    if (!sl || sl <= 0) {
      toast.error('Số lượng phát phải lớn hơn 0');
      return;
    }
    if (modalPhat && sl > modalPhat.qty_in_stock) {
      toast.error(
        `Tồn kho không đủ! Hiện có ${fmtSo(modalPhat.qty_in_stock)} ${modalPhat.unit}`,
      );
      return;
    }
    mutPhat.mutate();
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🎁 Quản lý quà tặng</h1>
          <p className="page-subtitle">
            Quản lý kho quà tặng kèm theo đơn hàng xe máy điện
          </p>
        </div>
        {!khongDuocThem && (
          <button className="btn btn-primary" onClick={moModalThem}>
            + Thêm quà tặng
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#2563eb' }}>
            {fmtSo(tongLoai)}
          </div>
          <div style={{ color: '#6b7280', marginTop: 4 }}>Tổng loại quà</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>
            {fmtSo(hetHang)}
          </div>
          <div style={{ color: '#6b7280', marginTop: 4 }}>Hết hàng</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#d97706' }}>
            {fmtSo(sapHet)}
          </div>
          <div style={{ color: '#6b7280', marginTop: 4 }}>Sắp hết tồn kho</div>
        </div>
      </div>

      {/* Cảnh báo */}
      {(hetHang > 0 || sapHet > 0) && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: '#92400e',
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>
            {hetHang > 0 && (
              <strong>{hetHang} loại quà đã hết hàng. </strong>
            )}
            {sapHet > 0 && (
              <strong>{sapHet} loại quà sắp hết tồn kho (dưới mức tối thiểu). </strong>
            )}
            Vui lòng nhập thêm hàng kịp thời.
          </span>
        </div>
      )}

      {/* Bộ lọc */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ minWidth: 240 }}>
            <input
              placeholder="Tìm theo mã, tên quà tặng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">Tất cả loại</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          {(search || filterCategory) && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearch('');
                setFilterCategory('');
              }}
            >
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* Bảng danh sách */}
      <div className="card">
        {isLoading ? (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        ) : danhSach.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎁</div>
            <div>Chưa có quà tặng nào{search || filterCategory ? ' phù hợp bộ lọc' : ''}</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên quà tặng</th>
                <th>Loại</th>
                <th style={{ textAlign: 'right' }}>Tồn kho</th>
                <th>Hiệu lực</th>
                <th style={{ textAlign: 'center', width: 80 }}>Thứ tự</th>
                <th style={{ textAlign: 'center' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {danhSach.map((item, idx) => {
                const tonThap =
                  item.qty_in_stock === 0
                    ? 'het'
                    : item.qty_in_stock <= item.qty_minimum
                    ? 'sap_het'
                    : 'ok';
                return (
                  <tr key={item.id}>
                    <td>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 13,
                          background: '#f3f4f6',
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                      >
                        {item.code}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{item.name}</div>
                      {item.note && (
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>{item.note}</div>
                      )}
                    </td>
                    <td>
                      {item.category ? (
                        <span
                          style={{
                            background: '#ede9fe',
                            color: '#5b21b6',
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color:
                            tonThap === 'het'
                              ? '#dc2626'
                              : tonThap === 'sap_het'
                              ? '#d97706'
                              : '#111827',
                        }}
                      >
                        {fmtSo(item.qty_in_stock)} {item.unit}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        Tối thiểu: {fmtSo(item.qty_minimum)}
                      </div>
                      {tonThap === 'het' && (
                        <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>
                          Hết hàng
                        </div>
                      )}
                      {tonThap === 'sap_het' && (
                        <div style={{ fontSize: 11, color: '#d97706', fontWeight: 500 }}>
                          Sắp hết
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(item.valid_from || item.valid_until) && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {fmtNgay(item.valid_from)} ~ {fmtNgay(item.valid_until)}
                          </div>
                        )}
                        {badgeHieuLuc(item)}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          {item.display_order ?? '—'}
                        </div>
                        {!khongDuocSua && (
                          <div style={{ display: 'flex', gap: 2 }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ padding: '2px 6px', fontSize: 11 }}
                              disabled={idx === 0 || mutSwapOrder.isPending}
                              onClick={() => {
                                const prev = danhSach[idx - 1];
                                if (prev) mutSwapOrder.mutate({ id: item.id, other_id: prev.id });
                              }}
                              title="Lên"
                            >↑</button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ padding: '2px 6px', fontSize: 11 }}
                              disabled={idx === danhSach.length - 1 || mutSwapOrder.isPending}
                              onClick={() => {
                                const next = danhSach[idx + 1];
                                if (next) mutSwapOrder.mutate({ id: item.id, other_id: next.id });
                              }}
                              title="Xuống"
                            >↓</button>
                          </div>
                        )}
                      </div>
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
                        {!khongDuocSua && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => moModalSua(item)}
                            title="Chỉnh sửa"
                          >
                            ✏️ Sửa
                          </button>
                        )}
                        {!khongDuocXuatNhap && (
                          <button
                            className="btn btn-sm"
                            style={{
                              background: '#dcfce7',
                              color: '#16a34a',
                              border: '1px solid #86efac',
                            }}
                            onClick={() => {
                              setNhapSoLuong('');
                              setNhapDonGia('');
                              setNhapGhiChu('');
                              setModalNhap(item);
                            }}
                            title="Nhập kho"
                          >
                            📦 Nhập
                          </button>
                        )}
                        {!khongDuocXuatNhap && (
                          <button
                            className="btn btn-sm"
                            style={{
                              background: '#ede9fe',
                              color: '#7c3aed',
                              border: '1px solid #c4b5fd',
                            }}
                            onClick={() => {
                              setPhatSoLuong('');
                              setPhatMaDon('');
                              setPhatGhiChu('');
                              setModalPhat(item);
                            }}
                            title="Phát quà"
                          >
                            🎁 Phát
                          </button>
                        )}
                        <button
                          className="btn btn-sm"
                          style={{
                            background: '#f0f9ff',
                            color: '#0369a1',
                            border: '1px solid #7dd3fc',
                          }}
                          onClick={() => setModalLichSu(item)}
                          title="Lịch sử"
                        >
                          📋 Lịch sử
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Modal Thêm / Sửa ─────────────────────────────────────────────────── */}
      {(modalThem || modalSua) && (
        <div
          className="modal-overlay"
          onClick={() => {
            setModalThem(false);
            setModalSua(null);
          }}
        >
          <div
            className="modal"
            style={{ maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">
                {modalSua ? '✏️ Chỉnh sửa quà tặng' : '➕ Thêm quà tặng mới'}
              </h2>
              <button
                className="modal-close"
                onClick={() => {
                  setModalThem(false);
                  setModalSua(null);
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={submitForm}>
              <div className="modal-body">
                <div className="form-grid">
                  {/* Tên */}
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">
                      Tên quà tặng <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      className="form-control"
                      placeholder="Nhập tên quà tặng"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>

                  {/* Loại */}
                  <div className="form-group">
                    <label className="form-label">Loại quà tặng</label>
                    <select
                      className="form-control"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      <option value="">-- Chọn loại --</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Đơn vị */}
                  <div className="form-group">
                    <label className="form-label">
                      Đơn vị <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      className="form-control"
                      placeholder="cái, chiếc, cái..."
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      required
                    />
                  </div>

                  {/* Tồn tối thiểu */}
                  <div className="form-group">
                    <label className="form-label">Tồn kho tối thiểu</label>
                    <input
                      className="form-control"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={form.qty_minimum}
                      onChange={(e) =>
                        setForm({ ...form, qty_minimum: Number(e.target.value) })
                      }
                    />
                  </div>

                  {/* Giá nhập */}
                  <div className="form-group">
                    <label className="form-label">Giá nhập (VND)</label>
                    <input
                      className="form-control"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={form.price_cost}
                      onChange={(e) =>
                        setForm({ ...form, price_cost: Number(e.target.value) })
                      }
                    />
                  </div>

                  {/* Hiệu lực từ */}
                  <div className="form-group">
                    <label className="form-label">Hiệu lực từ ngày</label>
                    <input
                      className="form-control"
                      type="date"
                      value={form.valid_from}
                      onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                    />
                  </div>

                  {/* Hiệu lực đến */}
                  <div className="form-group">
                    <label className="form-label">Hiệu lực đến ngày</label>
                    <input
                      className="form-control"
                      type="date"
                      value={form.valid_until}
                      onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                    />
                  </div>

                  {/* Thứ tự hiển thị */}
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">
                      Thứ tự hiển thị trong POS
                      <span style={{ color: '#888', fontWeight: 400 }}> (số nhỏ hiện trước, để trống = cuối danh sách)</span>
                    </label>
                    <input
                      className="form-control"
                      type="number"
                      placeholder="VD: 10, 20, 30..."
                      value={form.display_order}
                      onChange={(e) => setForm({ ...form, display_order: e.target.value })}
                    />
                  </div>

                  {/* Hình ảnh */}
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Hình ảnh quà tặng</label>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 80, height: 80, borderRadius: 10, flexShrink: 0,
                        border: '1.5px dashed #cbd5e1', background: '#f8fafc',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                      }}>
                        {form.image_url
                          ? <img src={form.image_url} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} onError={e => (e.currentTarget.style.display = 'none')} />
                          : <span style={{ fontSize: 28 }}>🎁</span>
                        }
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <label style={{
                            padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                            cursor: imgUploading ? 'wait' : 'pointer',
                            background: '#2563eb', color: '#fff',
                          }}>
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
                                cursor: 'pointer', background: '#fee2e2', color: '#991b1b', border: 'none',
                              }}
                            >🗑️ Xóa ảnh</button>
                          )}
                        </div>
                        <input
                          className="form-control"
                          placeholder="Hoặc dán URL ảnh"
                          value={form.image_url}
                          onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Ghi chú */}
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Ghi chú</label>
                    <textarea
                      className="form-control"
                      placeholder="Mô tả thêm về quà tặng..."
                      rows={3}
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setModalThem(false);
                    setModalSua(null);
                  }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={mutThem.isPending || mutSua.isPending}
                >
                  {mutThem.isPending || mutSua.isPending
                    ? 'Đang lưu...'
                    : modalSua
                    ? 'Cập nhật'
                    : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal Nhập kho ───────────────────────────────────────────────────── */}
      {modalNhap && (
        <div className="modal-overlay" onClick={() => setModalNhap(null)}>
          <div
            className="modal"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">📦 Nhập kho quà tặng</h2>
              <button className="modal-close" onClick={() => setModalNhap(null)}>
                ×
              </button>
            </div>
            <form onSubmit={submitNhap}>
              <div className="modal-body">
                {/* Thông tin mặt hàng */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: 20,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{modalNhap.name}</div>
                  <div style={{ fontSize: 13, color: '#6b7280' }}>
                    Mã: {modalNhap.code} &nbsp;|&nbsp; Tồn hiện tại:{' '}
                    <strong>
                      {fmtSo(modalNhap.qty_in_stock)} {modalNhap.unit}
                    </strong>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">
                      Số lượng nhập <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      className="form-control"
                      type="number"
                      min={1}
                      placeholder="Nhập số lượng"
                      value={nhapSoLuong}
                      onChange={(e) => setNhapSoLuong(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Đơn giá nhập (VND)</label>
                    <input
                      className="form-control"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={nhapDonGia}
                      onChange={(e) => setNhapDonGia(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Ghi chú</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="Nguồn hàng, đợt nhập..."
                      value={nhapGhiChu}
                      onChange={(e) => setNhapGhiChu(e.target.value)}
                    />
                  </div>

                  {/* Preview sau nhập */}
                  {nhapSoLuong && Number(nhapSoLuong) > 0 && (
                    <div
                      style={{
                        background: '#f0fdf4',
                        border: '1px solid #86efac',
                        borderRadius: 8,
                        padding: '10px 14px',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ color: '#16a34a', fontWeight: 600, marginBottom: 4 }}>
                        ✅ Dự kiến sau nhập
                      </div>
                      <div style={{ color: '#166534' }}>
                        Tồn kho: {fmtSo(modalNhap.qty_in_stock)} → &nbsp;
                        <strong>
                          {fmtSo(modalNhap.qty_in_stock + Number(nhapSoLuong))}{' '}
                          {modalNhap.unit}
                        </strong>
                      </div>
                      {nhapDonGia && Number(nhapDonGia) > 0 && (
                        <div style={{ color: '#166534' }}>
                          Thành tiền:{' '}
                          <strong>
                            {fmtTien(Number(nhapSoLuong) * Number(nhapDonGia))}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setModalNhap(null)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={mutNhap.isPending}
                >
                  {mutNhap.isPending ? 'Đang nhập...' : 'Xác nhận nhập kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal Phát quà ───────────────────────────────────────────────────── */}
      {modalPhat && (
        <div className="modal-overlay" onClick={() => setModalPhat(null)}>
          <div
            className="modal"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">🎁 Phát quà tặng</h2>
              <button className="modal-close" onClick={() => setModalPhat(null)}>
                ×
              </button>
            </div>
            <form onSubmit={submitPhat}>
              <div className="modal-body">
                {/* Thông tin mặt hàng */}
                <div
                  style={{
                    background: '#fdf4ff',
                    border: '1px solid #e9d5ff',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: 20,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{modalPhat.name}</div>
                  <div style={{ fontSize: 13, color: '#6b7280' }}>
                    Mã: {modalPhat.code} &nbsp;|&nbsp; Tồn hiện tại:{' '}
                    <strong
                      style={{
                        color:
                          modalPhat.qty_in_stock === 0
                            ? '#dc2626'
                            : '#7c3aed',
                      }}
                    >
                      {fmtSo(modalPhat.qty_in_stock)} {modalPhat.unit}
                    </strong>
                  </div>
                </div>

                {modalPhat.qty_in_stock === 0 && (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fca5a5',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      color: '#dc2626',
                      fontSize: 13,
                    }}
                  >
                    ⛔ Quà tặng này đã hết hàng, không thể phát.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">
                      Số lượng phát <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      className="form-control"
                      type="number"
                      min={1}
                      max={modalPhat.qty_in_stock}
                      placeholder="Nhập số lượng cần phát"
                      value={phatSoLuong}
                      onChange={(e) => setPhatSoLuong(e.target.value)}
                      autoFocus
                      required
                      disabled={modalPhat.qty_in_stock === 0}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Mã đơn hàng (nếu có)</label>
                    <input
                      className="form-control"
                      placeholder="DH2026..."
                      value={phatMaDon}
                      onChange={(e) => setPhatMaDon(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Ghi chú</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="Lý do phát, khách hàng..."
                      value={phatGhiChu}
                      onChange={(e) => setPhatGhiChu(e.target.value)}
                    />
                  </div>

                  {/* Kiểm tra tồn */}
                  {phatSoLuong && Number(phatSoLuong) > 0 && (
                    (() => {
                      const sl = Number(phatSoLuong);
                      const duTon = sl <= modalPhat.qty_in_stock;
                      return (
                        <div
                          style={{
                            background: duTon ? '#f0fdf4' : '#fef2f2',
                            border: `1px solid ${duTon ? '#86efac' : '#fca5a5'}`,
                            borderRadius: 8,
                            padding: '10px 14px',
                            fontSize: 13,
                          }}
                        >
                          {duTon ? (
                            <>
                              <div
                                style={{ color: '#16a34a', fontWeight: 600, marginBottom: 4 }}
                              >
                                ✅ Tồn kho đủ để phát
                              </div>
                              <div style={{ color: '#166534' }}>
                                Sau khi phát: {fmtSo(modalPhat.qty_in_stock)} →{' '}
                                <strong>
                                  {fmtSo(modalPhat.qty_in_stock - sl)} {modalPhat.unit}
                                </strong>
                              </div>
                            </>
                          ) : (
                            <div style={{ color: '#dc2626', fontWeight: 600 }}>
                              ❌ Không đủ tồn kho! Hiện có{' '}
                              {fmtSo(modalPhat.qty_in_stock)} {modalPhat.unit}
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setModalPhat(null)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    mutPhat.isPending ||
                    modalPhat.qty_in_stock === 0 ||
                    (!!phatSoLuong && Number(phatSoLuong) > modalPhat.qty_in_stock)
                  }
                  style={{
                    background: '#7c3aed',
                    borderColor: '#7c3aed',
                  }}
                >
                  {mutPhat.isPending ? 'Đang phát...' : 'Xác nhận phát quà'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal Lịch sử ────────────────────────────────────────────────────── */}
      {modalLichSu && (
        <div className="modal-overlay" onClick={() => setModalLichSu(null)}>
          <div
            className="modal"
            style={{ maxWidth: 760 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 className="modal-title">📋 Lịch sử nhập/xuất kho</h2>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  {modalLichSu.name} ({modalLichSu.code})
                </div>
              </div>
              <button className="modal-close" onClick={() => setModalLichSu(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {loadingMovements ? (
                <div className="loading-center">
                  <div className="spinner" />
                </div>
              ) : !movementsData?.data?.length ? (
                <div className="empty-state">
                  <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                  <div>Chưa có lịch sử giao dịch nào</div>
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Loại giao dịch</th>
                      <th style={{ textAlign: 'right' }}>Số lượng</th>
                      <th style={{ textAlign: 'right' }}>Đơn giá</th>
                      <th>Mã đơn hàng</th>
                      <th>Nhân viên</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementsData.data.map((mv) => {
                      const loai = MOVEMENT_LABELS[mv.movement_type] ?? {
                        label: mv.movement_type,
                        color: '#6b7280',
                      };
                      const isExport = mv.quantity < 0;
                      return (
                        <tr key={mv.id}>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                            {new Date(mv.created_at).toLocaleString('vi-VN')}
                          </td>
                          <td>
                            <span
                              style={{
                                background: loai.color + '22',
                                color: loai.color,
                                padding: '2px 8px',
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {loai.label}
                            </span>
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 600,
                              color: isExport ? '#dc2626' : '#16a34a',
                            }}
                          >
                            {isExport ? '-' : '+'}{fmtSo(Math.abs(mv.quantity))}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13 }}>
                            {mv.unit_cost ? fmtTien(mv.unit_cost) : '—'}
                          </td>
                          <td style={{ fontSize: 13 }}>
                            {mv.sales_orders?.order_number ? (
                              <span
                                style={{
                                  fontFamily: 'monospace',
                                  background: '#f3f4f6',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                }}
                              >
                                {mv.sales_orders.order_number}
                              </span>
                            ) : (
                              <span style={{ color: '#9ca3af' }}>—</span>
                            )}
                          </td>
                          <td style={{ fontSize: 13 }}>
                            {mv.users?.full_name ?? (
                              <span style={{ color: '#9ca3af' }}>—</span>
                            )}
                          </td>
                          <td style={{ fontSize: 13, color: '#6b7280', maxWidth: 160 }}>
                            {mv.note ?? <span style={{ color: '#9ca3af' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                Tổng {movementsData?.total ?? 0} giao dịch
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setModalLichSu(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
