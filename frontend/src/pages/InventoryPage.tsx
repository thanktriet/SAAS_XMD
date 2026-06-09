// Trang Tồn kho xe — danh sách + nhập xe mới + sửa + xóa + import Excel
import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { InventoryVehicle, VehicleModel, PaginatedResponse } from '../types';
import { formatCurrency, formatDate, VEHICLE_STATUS } from '../utils/helpers';
import { mauToHex } from '../utils/colors';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import './InventoryPage.css';

// ─── Types cho import Excel ───────────────────────────────────────────────────
interface ImportRow {
  row_number:       number;
  vin:              string;
  vehicle_model_id: string | null;
  ma_model_raw:     string;
  engine_number:    string | null;
  battery_serial:   string | null;
  color:            string | null;
  year_manufacture: number | null;
  import_date:      string | null;
  import_price:     number | null;
  status:           string;
  notes:            string | null;
  errors:           string[];
  warnings:         string[];
  valid:            boolean;
}

interface ImportSummary {
  total: number; valid: number; invalid: number; warnings: number;
}


// ─── Form nhập xe ────────────────────────────────────────────────────────────
interface FormNhapXe {
  vehicle_model_id: string;
  vin:              string;
  engine_number:    string;
  battery_serial:   string;
  color:            string;
  year_manufacture: string | number;
  import_date:      string;
  import_price:     string | number;
  status:           InventoryVehicle['status'];
  notes:            string;
}

const INIT_FORM: FormNhapXe = {
  vehicle_model_id: '',
  vin:              '',
  engine_number:    '',
  battery_serial:   '',
  color:            '',
  year_manufacture: new Date().getFullYear(),
  import_date:      new Date().toISOString().slice(0, 10),
  import_price:     '',
  status:           'in_stock',
  notes:            '',
};

const STATUS_NHAP: Array<{ value: InventoryVehicle['status']; label: string }> = [
  { value: 'in_stock',        label: 'Còn hàng' },
  { value: 'demo',            label: 'Trưng bày' },
  { value: 'reserved',        label: 'Đã đặt cọc' },
  { value: 'warranty_repair', label: 'Đang sửa' },
];

// ─── Component chính ─────────────────────────────────────────────────────────
export default function InventoryPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const laSales   = user?.role === 'sales';
  const laManager = user?.role === 'manager';
  // Sales không được làm gì cả; Manager được Thêm/Import nhưng không được Sửa/Xóa
  const khongDuocThem = laSales;
  const khongDuocSua  = laSales || laManager;

  // Bộ lọc danh sách
  const [statusFilter, setStatusFilter] = useState('');
  const [modelFilter,  setModelFilter]  = useState('');
  const [search,       setSearch]       = useState('');
  const [page,         setPage]         = useState(1);

  // Modal
  const [modal,    setModal]    = useState<'add' | 'edit' | null>(null);
  const [editItem, setEditItem] = useState<InventoryVehicle | null>(null);
  const [form,     setForm]     = useState<FormNhapXe>({ ...INIT_FORM });

  // Nhập màu tuỳ chỉnh khi model không có sẵn
  const [customMau, setCustomMau] = useState('');

  // ─── State Import Excel ────────────────────────────────────────────────────
  const fileInputRef                              = useRef<HTMLInputElement>(null);
  const [importModal, setImportModal]             = useState(false);
  const [importFile,  setImportFile]              = useState<File | null>(null);
  const [importRows,  setImportRows]              = useState<ImportRow[]>([]);
  const [importSum,   setImportSum]               = useState<ImportSummary | null>(null);
  const [importLoading, setImportLoading]         = useState(false);
  const [importStep,  setImportStep]              = useState<'upload' | 'preview'>('upload');
  // Cho phép bỏ tick các dòng muốn bỏ qua
  const [skipRows,    setSkipRows]                = useState<Set<number>>(new Set());

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<PaginatedResponse<InventoryVehicle>>({
    queryKey: ['inventory', statusFilter, modelFilter, search, page],
    queryFn: () =>
      api.get('/inventory', {
        params: {
          status:           statusFilter  || undefined,
          model_id:         modelFilter   || undefined,
          search:           search        || undefined,
          page,
          limit: 15,
        },
      }).then(r => r.data),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: () => api.get('/inventory/summary').then(r => r.data),
  });

  const { data: dsModel } = useQuery<{ data: VehicleModel[] }>({
    queryKey: ['vehicle-models'],
    queryFn: () => api.get('/vehicles', { params: { limit: 100 } }).then(r => r.data),
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: (body: any) => api.post('/inventory', body).then(r => r.data),
    onSuccess: () => {
      invalidate();
      setModal(null);
      toast.success('Đã nhập xe vào kho');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi nhập kho'),
  });

  const editMut = useMutation({
    mutationFn: (body: any) => api.put(`/inventory/${editItem?.id}`, body).then(r => r.data),
    onSuccess: () => {
      invalidate();
      setModal(null);
      toast.success('Cập nhật xe thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Đã xóa xe khỏi kho');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể xóa'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['inventory'] });
    qc.invalidateQueries({ queryKey: ['inventory-summary'] });
  };

  // ─── Model đang chọn trong form ────────────────────────────────────────────
  const modelChon = useMemo(
    () => dsModel?.data?.find(m => m.id === form.vehicle_model_id) ?? null,
    [dsModel, form.vehicle_model_id],
  );

  const dsMAU = modelChon?.available_colors ?? [];

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm({ ...INIT_FORM });
    setCustomMau('');
    setEditItem(null);
    setModal('add');
  };

  const openEdit = (v: InventoryVehicle) => {
    setEditItem(v);
    setForm({
      vehicle_model_id: v.vehicle_model_id,
      vin:              v.vin,
      engine_number:    (v as any).engine_number ?? '',
      battery_serial:   (v as any).battery_serial ?? '',
      color:            v.color ?? '',
      year_manufacture: (v as any).year_manufacture ?? new Date().getFullYear(),
      import_date:      (v as any).import_date ?? new Date().toISOString().slice(0, 10),
      import_price:     (v as any).import_price ?? '',
      status:           v.status,
      notes:            (v as any).notes ?? '',
    });
    setCustomMau('');
    setModal('edit');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vehicle_model_id) { toast.error('Chọn mẫu xe'); return; }
    if (!form.vin.trim())       { toast.error('Nhập số khung (VIN)'); return; }
    if (!form.color.trim())     { toast.error('Chọn màu xe'); return; }

    const payload = {
      ...form,
      import_price:     form.import_price     === '' ? null : Number(form.import_price),
      year_manufacture: form.year_manufacture === '' ? null : Number(form.year_manufacture),
      engine_number:    form.engine_number.trim()  || null,
      battery_serial:   form.battery_serial.trim() || null,
      notes:            form.notes.trim()           || null,
    };

    modal === 'add' ? addMut.mutate(payload) : editMut.mutate(payload);
  };

  const f = (field: keyof FormNhapXe) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [field]: e.target.value }));

  const totalPages = Math.ceil((data?.total || 0) / 15);

  // ─── Handlers Import Excel ─────────────────────────────────────────────────

  const openImportModal = () => {
    setImportModal(true);
    setImportStep('upload');
    setImportFile(null);
    setImportRows([]);
    setImportSum(null);
    setSkipRows(new Set());
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setImportFile(f);
  };

  const handlePreview = async () => {
    if (!importFile) { toast.error('Chọn file Excel trước'); return; }
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const { data: res } = await api.post('/inventory/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportRows(res.rows);
      setImportSum(res.summary);
      setSkipRows(new Set(res.rows.filter((r: ImportRow) => !r.valid).map((r: ImportRow) => r.row_number)));
      setImportStep('preview');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Lỗi đọc file');
    } finally {
      setImportLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    const toImport = importRows.filter(r => r.valid && !skipRows.has(r.row_number));
    if (!toImport.length) { toast.error('Không có dòng nào được chọn'); return; }
    setImportLoading(true);
    try {
      const { data: res } = await api.post('/inventory/import/confirm', { rows: toImport });
      toast.success(res.message);
      setImportModal(false);
      invalidate();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Lỗi nhập kho');
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/inventory/import/template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a');
      a.href    = url;
      a.download = 'mau_nhap_kho_xe.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Không tải được file mẫu');
    }
  };

  const toggleSkip = (rowNum: number) =>
    setSkipRows(prev => {
      const next = new Set(prev);
      next.has(rowNum) ? next.delete(rowNum) : next.add(rowNum);
      return next;
    });

  const validSelected = importRows.filter(r => r.valid && !skipRows.has(r.row_number)).length;

  // Tổng thống kê nhanh
  const tongXe       = data?.total ?? 0;
  const tongConHang  = summaryData?.reduce((s: number, x: any) => s + Number(x.in_stock ?? 0), 0) ?? 0;
  const tongDaBan    = summaryData?.reduce((s: number, x: any) => s + Number(x.sold ?? 0), 0) ?? 0;
  const tongDatCoc   = summaryData?.reduce((s: number, x: any) => s + Number(x.reserved ?? 0), 0) ?? 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* TOPBAR */}
      <div className="topbar">
        <span className="topbar-title">📦 Tồn kho xe</span>
        {!khongDuocThem && (
          <div className="topbar-actions">
            <button className="btn btn-secondary btn-sm" onClick={openImportModal}><span>📊 </span>Import</button>
            <button className="btn btn-primary btn-sm"   onClick={openAdd}><span>+ </span>Nhập xe</button>
          </div>
        )}
      </div>

      <div className="page-content">

        {/* ── Stat cards tóm tắt theo model ── */}
        {(summaryData?.length ?? 0) > 0 && (
          <div className="inv-stat-grid">
            {summaryData.map((s: any) => (
              <div
                key={s.model_id ?? s.model_name}
                className={`inv-stat-card${modelFilter === s.model_id ? ' active' : ''}`}
                onClick={() => setModelFilter(p => p === s.model_id ? '' : s.model_id)}
              >
                {s.image_url && (
                  <img src={s.image_url} alt={s.model_name} className="inv-stat-img" />
                )}
                <div className="inv-stat-body">
                  <div className="inv-stat-brand">{s.brand}</div>
                  <div className="inv-stat-model">{s.model_name}</div>
                  <div className="inv-stat-nums">
                    <span className="inv-stat-main">{Number(s.in_stock ?? 0)}</span>
                    <span className="inv-stat-sub">/ {Number(s.total ?? 0)} tổng</span>
                  </div>
                  <div className="inv-stat-breakdown">
                    {(Number(s.reserved) ?? 0) > 0 && (
                      <span className="inv-stat-tag" style={{ background: '#fff7ed', color: '#9a3412' }}>
                        🟠 {Number(s.reserved)} đặt cọc
                      </span>
                    )}
                    {(Number(s.sold) ?? 0) > 0 && (
                      <span className="inv-stat-tag" style={{ background: '#f3f4f6', color: '#374151' }}>
                        ⚫ {Number(s.sold)} đã bán
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Bảng danh sách ── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              Danh sách xe trong kho
              {tongConHang > 0 && (
                <span className="badge badge-green" style={{ marginLeft: 8, fontSize: 12 }}>
                  {tongConHang} còn hàng
                </span>
              )}
              {tongDatCoc > 0 && (
                <span className="badge badge-orange" style={{ marginLeft: 6, fontSize: 12 }}>
                  {tongDatCoc} đặt cọc
                </span>
              )}
              {tongDaBan > 0 && (
                <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 12 }}>
                  {tongDaBan} đã bán
                </span>
              )}
            </span>
            <div className="inv-filters">
              <div className="search-box">
                <span>🔍</span>
                <input
                  placeholder="Tìm VIN, màu, số máy..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <select
                className="filter-select"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              >
                <option value="">Tất cả trạng thái</option>
                {Object.entries(VEHICLE_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              {modelFilter && (
                <button className="btn btn-secondary btn-sm" onClick={() => setModelFilter('')}>
                  ✕ Bỏ lọc model
                </button>
              )}
            </div>
          </div>

          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : (data?.data?.length ?? 0) === 0 ? (
              <div className="empty-state">
                <p>Không có xe nào{statusFilter ? ` với trạng thái "${VEHICLE_STATUS[statusFilter]?.label}"` : ''}</p>
                {!khongDuocThem && (
                  <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openAdd}>
                    + Nhập xe đầu tiên
                  </button>
                )}
              </div>
            ) : (
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th>Mẫu xe</th>
                    <th>Số khung (VIN)</th>
                    <th className="hide-mobile">Số máy</th>
                    <th className="hide-mobile">Màu sắc</th>
                    <th className="hide-mobile">Năm SX</th>
                    <th>Giá nhập</th>
                    <th className="hide-mobile">Ngày nhập</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data!.data.map(v => (
                    <tr key={v.id}>
                      <td>
                        <div className="inv-model-cell">
                          {v.vehicle_models?.image_url ? (
                            <img src={v.vehicle_models.image_url} alt="" className="inv-row-thumb" />
                          ) : (
                            <div className="inv-row-thumb-ph">🛵</div>
                          )}
                          <div>
                            <div className="fw-600">{v.vehicle_models?.brand} {v.vehicle_models?.model_name}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              {v.vehicle_models?.category?.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td><span className="font-mono inv-vin">{v.vin}</span></td>
                      <td data-label="Số máy" className="text-muted font-mono hide-mobile" style={{ fontSize: 12 }}>
                        {(v as any).engine_number || '—'}
                      </td>
                      <td data-label="Màu sắc" className="hide-mobile">
                        <div className="inv-color-cell">
                          <span
                            className="inv-color-dot"
                            style={{ background: mauToHex(v.color) }}
                          />
                          {v.color || '—'}
                        </div>
                      </td>
                      <td data-label="Năm SX" className="text-muted hide-mobile">{(v as any).year_manufacture || '—'}</td>
                      <td data-label="Giá nhập">{(v as any).import_price ? formatCurrency((v as any).import_price) : '—'}</td>
                      <td data-label="Ngày nhập" className="text-muted hide-mobile">
                        {(v as any).import_date ? formatDate((v as any).import_date) : '—'}
                      </td>
                      <td data-label="Trạng thái">
                        <span className={`badge ${VEHICLE_STATUS[v.status]?.cls ?? 'badge-gray'}`}>
                          {VEHICLE_STATUS[v.status]?.label ?? v.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5 }}>
                          {khongDuocSua ? (
                            <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                          ) : (
                            <>
                              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(v)}>✏️</button>
                              {['in_stock', 'demo'].includes(v.status) && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  disabled={deleteMut.isPending}
                                  onClick={() => {
                                    if (confirm(`Xóa xe VIN ${v.vin} khỏi kho?`)) deleteMut.mutate(v.id);
                                  }}
                                >🗑️</button>
                              )}
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
              <span className="pagination-info">
                {tongXe} xe · Trang {page}/{totalPages}
              </span>
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                return start + i;
              }).map(p => (
                <button
                  key={p}
                  className={`page-btn${page === p ? ' active' : ''}`}
                  onClick={() => setPage(p)}
                >{p}</button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MODAL NHẬP / SỬA XE ═══ */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal inv-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {modal === 'add' ? '📥 Nhập xe mới vào kho' : `✏️ Sửa xe: ${editItem?.vin}`}
              </span>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body inv-form-body">

                {/* ── CỘT TRÁI ── */}
                <div className="inv-form-col">

                  {/* Chọn mẫu xe */}
                  <div className="inv-section">
                    <div className="inv-section-title">🏍️ Mẫu xe</div>
                    <div className="form-group">
                      <label className="form-label">Dòng xe <span className="required">*</span></label>
                      <select
                        className="form-control"
                        required
                        value={form.vehicle_model_id}
                        onChange={e => {
                          setForm(p => ({ ...p, vehicle_model_id: e.target.value, color: '' }));
                          setCustomMau('');
                        }}
                      >
                        <option value="">— Chọn mẫu xe —</option>
                        {(dsModel?.data ?? []).map(m => (
                          <option key={m.id} value={m.id}>
                            {m.brand} {m.model_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Preview model */}
                    {modelChon && (
                      <div className="inv-model-preview">
                        {modelChon.image_url && (
                          <img src={modelChon.image_url} alt={modelChon.model_name} className="inv-model-preview-img" />
                        )}
                        <div className="inv-model-preview-info">
                          <div className="inv-model-preview-name">{modelChon.brand} {modelChon.model_name}</div>
                          <div className="inv-model-preview-price">
                            Giá nhập tham chiếu: <b>{formatCurrency(modelChon.price_cost)}</b>
                          </div>
                          <div className="inv-model-preview-price">
                            Giá bán: <b className="text-primary">{formatCurrency(modelChon.price_sell)}</b>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Màu sắc */}
                  <div className="inv-section">
                    <div className="inv-section-title">🎨 Màu sắc <span className="required">*</span></div>

                    {dsMAU.length > 0 ? (
                      /* Màu từ model */
                      <div className="inv-mau-options">
                        {dsMAU.map(mau => (
                          <button
                            type="button"
                            key={mau}
                            className={`inv-mau-btn${form.color === mau ? ' active' : ''}`}
                            onClick={() => setForm(p => ({ ...p, color: mau }))}
                          >
                            <span
                              className="inv-mau-dot"
                              style={{ background: mauToHex(mau) }}
                            />
                            {mau}
                          </button>
                        ))}
                      </div>
                    ) : (
                      /* Nhập tự do khi model không có màu định sẵn */
                      <input
                        className="form-control"
                        placeholder="VD: Trắng, Đen, Đỏ..."
                        value={form.color}
                        onChange={f('color')}
                        required
                      />
                    )}

                    {/* Cho phép nhập màu khác nếu muốn */}
                    {dsMAU.length > 0 && (
                      <div className="inv-mau-custom">
                        <input
                          className="form-control"
                          placeholder="Màu khác (không có trong danh sách)..."
                          value={customMau}
                          onChange={e => {
                            setCustomMau(e.target.value);
                            if (e.target.value) setForm(p => ({ ...p, color: e.target.value }));
                          }}
                        />
                      </div>
                    )}

                    {form.color && (
                      <div className="inv-mau-selected">
                        <span
                          className="inv-mau-dot"
                          style={{ background: mauToHex(form.color) }}
                        />
                        Đã chọn: <b>{form.color}</b>
                      </div>
                    )}
                  </div>

                  {/* Trạng thái & Năm SX */}
                  <div className="inv-section">
                    <div className="inv-section-title">📋 Thông tin nhập kho</div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Trạng thái</label>
                        <select className="form-control" value={form.status} onChange={f('status')}>
                          {STATUS_NHAP.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Năm sản xuất</label>
                        <input
                          className="form-control"
                          type="number"
                          min="2015" max="2030"
                          value={form.year_manufacture}
                          onChange={f('year_manufacture')}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Ngày nhập kho</label>
                        <input
                          className="form-control"
                          type="date"
                          value={form.import_date}
                          onChange={f('import_date')}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Giá nhập (VNĐ)</label>
                        <input
                          className="form-control"
                          type="number"
                          min="0"
                          placeholder={modelChon ? String(modelChon.price_cost) : '0'}
                          value={form.import_price}
                          onChange={f('import_price')}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── CỘT PHẢI ── */}
                <div className="inv-form-col">

                  {/* Số khung + số máy */}
                  <div className="inv-section">
                    <div className="inv-section-title">🔢 Số serial</div>
                    <div className="form-group">
                      <label className="form-label">
                        Số khung (VIN) <span className="required">*</span>
                      </label>
                      <input
                        className="form-control inv-vin-input"
                        required
                        placeholder="VD: VF1AAAAA1234567"
                        value={form.vin}
                        onChange={e => setForm(p => ({ ...p, vin: e.target.value.toUpperCase() }))}
                        style={{ fontFamily: 'monospace', letterSpacing: 1 }}
                      />
                      <div className="form-hint">Số khung duy nhất, không trùng với xe khác</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Số máy / số motor</label>
                      <input
                        className="form-control"
                        placeholder="VD: EV20230456"
                        value={form.engine_number}
                        onChange={f('engine_number')}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Số serial pin (battery)</label>
                      <input
                        className="form-control"
                        placeholder="VD: BAT-LFP-2024-001"
                        value={form.battery_serial}
                        onChange={f('battery_serial')}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>

                  {/* Ghi chú */}
                  <div className="inv-section">
                    <div className="inv-section-title">📝 Ghi chú</div>
                    <div className="form-group">
                      <textarea
                        className="form-control"
                        rows={4}
                        placeholder="Tình trạng xe khi nhập, ghi chú đặc biệt..."
                        value={form.notes}
                        onChange={f('notes')}
                      />
                    </div>
                  </div>

                  {/* Tổng kết */}
                  {modelChon && (
                    <div className="inv-summary-box">
                      <div className="inv-summary-title">Tóm tắt</div>
                      <div className="inv-summary-row">
                        <span>Mẫu xe</span>
                        <b>{modelChon.brand} {modelChon.model_name}</b>
                      </div>
                      {form.color && (
                        <div className="inv-summary-row">
                          <span>Màu</span>
                          <b>
                            <span className="inv-mau-dot" style={{ background: mauToHex(form.color), marginRight: 4 }} />
                            {form.color}
                          </b>
                        </div>
                      )}
                      {form.vin && (
                        <div className="inv-summary-row">
                          <span>VIN</span>
                          <b className="font-mono">{form.vin}</b>
                        </div>
                      )}
                      {form.import_price && (
                        <div className="inv-summary-row">
                          <span>Giá nhập</span>
                          <b className="text-primary">{formatCurrency(Number(form.import_price))}</b>
                        </div>
                      )}
                      <div className="inv-summary-row">
                        <span>Trạng thái</span>
                        <span className={`badge ${VEHICLE_STATUS[form.status]?.cls}`}>
                          {VEHICLE_STATUS[form.status]?.label}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Huỷ</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addMut.isPending || editMut.isPending}
                >
                  {(addMut.isPending || editMut.isPending) ? 'Đang lưu...' : modal === 'add' ? '📥 Nhập kho' : '💾 Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ═══ MODAL IMPORT EXCEL ═══ */}
      {importModal && (
        <div className="modal-overlay" onClick={() => !importLoading && setImportModal(false)}>
          <div className="modal" style={{ maxWidth: importStep === 'preview' ? 900 : 520, width: '95vw' }}
               onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="modal-header">
              <span className="modal-title">
                {importStep === 'upload' ? '📊 Import kho xe từ Excel' : `📋 Preview — ${importSum?.total} dòng`}
              </span>
              <button className="modal-close" onClick={() => setImportModal(false)} disabled={importLoading}>×</button>
            </div>

            <div className="modal-body">

              {/* ── BƯỚC 1: Chọn file ── */}
              {importStep === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                  {/* Tải file mẫu */}
                  <div className="import-guide-box">
                    <div className="import-guide-title">📥 Chưa có file mẫu?</div>
                    <p style={{ margin: '4px 0 10px', color: 'var(--text-muted)', fontSize: 13 }}>
                      Tải file mẫu Excel đã có sẵn header và hướng dẫn, điền dữ liệu rồi upload lại.
                    </p>
                    <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
                      ⬇️ Tải file mẫu (.xlsx)
                    </button>
                  </div>

                  {/* Vùng kéo thả / chọn file */}
                  <div
                    className={`import-dropzone${importFile ? ' has-file' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f) setImportFile(f);
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      style={{ display: 'none' }}
                      onChange={handleFileChange}
                    />
                    {importFile ? (
                      <>
                        <div className="import-file-icon">📄</div>
                        <div className="import-file-name">{importFile.name}</div>
                        <div className="import-file-size">
                          {(importFile.size / 1024).toFixed(1)} KB
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                          Nhấn để chọn file khác
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 40, marginBottom: 8 }}>📂</div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Kéo thả file vào đây</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                          hoặc nhấn để chọn file .xlsx / .xls (tối đa 10 MB)
                        </div>
                      </>
                    )}
                  </div>

                  {/* Ghi chú cột */}
                  <div className="import-cols-hint">
                    <span className="import-hint-label">Cột bắt buộc:</span>
                    <code>vin</code><code>ma_model</code>
                    <span className="import-hint-label" style={{ marginLeft: 12 }}>Cột tuỳ chọn:</span>
                    <code>mau_sac</code><code>so_may</code><code>so_pin</code>
                    <code>nam_sx</code><code>ngay_nhap</code><code>gia_nhap</code>
                    <code>trang_thai</code><code>ghi_chu</code>
                  </div>
                </div>
              )}

              {/* ── BƯỚC 2: Preview kết quả parse ── */}
              {importStep === 'preview' && importSum && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Thống kê tổng */}
                  <div className="import-stat-row">
                    <div className="import-stat-card import-stat-total">
                      <div className="import-stat-num">{importSum.total}</div>
                      <div className="import-stat-lbl">Tổng dòng</div>
                    </div>
                    <div className="import-stat-card import-stat-ok">
                      <div className="import-stat-num">{importSum.valid}</div>
                      <div className="import-stat-lbl">Hợp lệ</div>
                    </div>
                    <div className={`import-stat-card ${importSum.invalid > 0 ? 'import-stat-err' : 'import-stat-ok'}`}>
                      <div className="import-stat-num">{importSum.invalid}</div>
                      <div className="import-stat-lbl">Lỗi</div>
                    </div>
                    <div className={`import-stat-card ${importSum.warnings > 0 ? 'import-stat-warn' : 'import-stat-ok'}`}>
                      <div className="import-stat-num">{importSum.warnings}</div>
                      <div className="import-stat-lbl">Cảnh báo</div>
                    </div>
                    <div className="import-stat-card import-stat-sel">
                      <div className="import-stat-num">{validSelected}</div>
                      <div className="import-stat-lbl">Sẽ nhập</div>
                    </div>
                  </div>

                  {/* Bảng preview */}
                  <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 36 }}>✓</th>
                          <th>Dòng</th>
                          <th>VIN</th>
                          <th>Model</th>
                          <th>Màu</th>
                          <th>Năm</th>
                          <th>Giá nhập</th>
                          <th>TT</th>
                          <th>Lỗi / Cảnh báo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map(row => {
                          const isSkipped = skipRows.has(row.row_number);
                          return (
                            <tr
                              key={row.row_number}
                              className={
                                !row.valid       ? 'import-row-error'
                                : isSkipped      ? 'import-row-skipped'
                                : row.warnings.length ? 'import-row-warn'
                                : ''
                              }
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  checked={row.valid && !isSkipped}
                                  disabled={!row.valid}
                                  onChange={() => row.valid && toggleSkip(row.row_number)}
                                />
                              </td>
                              <td className="text-muted" style={{ fontSize: 12 }}>{row.row_number}</td>
                              <td className="font-mono" style={{ fontSize: 12 }}>{row.vin || '—'}</td>
                              <td style={{ fontSize: 12 }}>{row.ma_model_raw || '—'}</td>
                              <td style={{ fontSize: 12 }}>{row.color || '—'}</td>
                              <td style={{ fontSize: 12 }}>{row.year_manufacture || '—'}</td>
                              <td style={{ fontSize: 12 }}>
                                {row.import_price ? formatCurrency(row.import_price) : '—'}
                              </td>
                              <td>
                                <span className={`badge ${
                                  row.status === 'in_stock' ? 'badge-green'
                                  : row.status === 'sold'    ? 'badge-gray'
                                  : row.status === 'demo'    ? 'badge-blue'
                                  : 'badge-yellow'
                                }`} style={{ fontSize: 10 }}>
                                  {VEHICLE_STATUS[row.status]?.label ?? row.status}
                                </span>
                              </td>
                              <td style={{ fontSize: 11 }}>
                                {row.errors.map((e, i) => (
                                  <div key={i} className="import-msg-error">⛔ {e}</div>
                                ))}
                                {row.warnings.map((w, i) => (
                                  <div key={i} className="import-msg-warn">⚠️ {w}</div>
                                ))}
                                {row.valid && !row.warnings.length && (
                                  <span style={{ color: 'var(--success)' }}>✅ OK</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {importSum.invalid > 0 && (
                    <div className="import-warn-note">
                      ⚠️ Các dòng <b>lỗi</b> sẽ bị bỏ qua. Bạn có thể bỏ tick các dòng không muốn nhập.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="modal-footer">
              {importStep === 'upload' ? (
                <>
                  <button className="btn btn-secondary" onClick={() => setImportModal(false)}>Huỷ</button>
                  <button
                    className="btn btn-primary"
                    disabled={!importFile || importLoading}
                    onClick={handlePreview}
                  >
                    {importLoading ? 'Đang đọc...' : '📋 Xem trước dữ liệu →'}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={() => setImportStep('upload')} disabled={importLoading}>
                    ← Chọn file khác
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={validSelected === 0 || importLoading}
                    onClick={handleConfirmImport}
                  >
                    {importLoading ? 'Đang nhập...' : `📥 Nhập ${validSelected} xe vào kho`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
