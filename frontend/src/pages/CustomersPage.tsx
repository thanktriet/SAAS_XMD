// Trang Quản lý Khách hàng
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Customer, PaginatedResponse } from '../types';
import { formatDate } from '../utils/helpers';
import toast from 'react-hot-toast';

type FormState = {
  full_name: string;
  phone: string;
  email: string;
  // Cá nhân
  gender: '' | 'male' | 'female' | 'other';
  source: '' | 'referral' | 'facebook' | 'zalo' | 'showroom' | 'website' | 'call_center' | 'other';
  id_card: string;
  id_card_date: string;
  id_card_place: string;
  date_of_birth: string;
  // Địa chỉ giao hàng
  address: string;
  district: string;
  province: string;
  // Doanh nghiệp
  customer_type: 'individual' | 'business';
  company_name: string;
  tax_code: string;
  representative_name: string;
  representative_title: string;
  // Địa chỉ xuất hóa đơn
  invoice_address: string;
  invoice_district: string;
  invoice_province: string;
  notes: string;
};

const INITIAL_FORM: FormState = {
  full_name: '',
  phone: '',
  email: '',
  gender: '',
  source: '',
  id_card: '',
  id_card_date: '',
  id_card_place: '',
  date_of_birth: '',
  address: '',
  district: '',
  province: '',
  customer_type: 'individual',
  company_name: '',
  tax_code: '',
  representative_name: '',
  representative_title: '',
  invoice_address: '',
  invoice_district: '',
  invoice_province: '',
  notes: '',
};

function fromCustomer(c: Customer): FormState {
  return {
    full_name:            c.full_name,
    phone:                c.phone,
    email:                c.email                ?? '',
    gender:               c.gender               ?? '',
    source:               c.source               ?? '',
    id_card:              c.id_card              ?? '',
    id_card_date:         c.id_card_date         ?? '',
    id_card_place:        c.id_card_place        ?? '',
    date_of_birth:        c.date_of_birth        ?? '',
    address:              c.address              ?? '',
    district:             c.district             ?? '',
    province:             c.province             ?? '',
    customer_type:        c.customer_type,
    company_name:         c.company_name         ?? '',
    tax_code:             c.tax_code             ?? '',
    representative_name:  c.representative_name  ?? '',
    representative_title: c.representative_title ?? '',
    invoice_address:      c.invoice_address      ?? '',
    invoice_district:     c.invoice_district     ?? '',
    invoice_province:     c.invoice_province     ?? '',
    notes:                c.notes                ?? '',
  };
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [modal, setModal]     = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm]       = useState<FormState>(INITIAL_FORM);

  const f = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const { data, isLoading } = useQuery<PaginatedResponse<Customer>>({
    queryKey: ['customers', search, page],
    queryFn: () => api.get('/customers', { params: { search, page, limit: 15 } }).then(r => r.data),
  });

  const createMut = useMutation({
    mutationFn: (body: FormState) => api.post('/customers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setModal(null);
      toast.success('Thêm khách hàng thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi khi thêm khách hàng'),
  });

  const updateMut = useMutation({
    mutationFn: (body: FormState) => api.put(`/customers/${editing?.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setModal(null);
      toast.success('Cập nhật thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi khi cập nhật'),
  });

  const openCreate = () => { setForm(INITIAL_FORM); setEditing(null); setModal('create'); };
  const openEdit   = (c: Customer) => { setEditing(c); setForm(fromCustomer(c)); setModal('edit'); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) { toast.error('Nhập họ tên khách hàng'); return; }
    if (!form.phone.trim())     { toast.error('Nhập số điện thoại'); return; }
    if (!form.address.trim())   { toast.error('Nhập địa chỉ (cần để xuất hóa đơn)'); return; }
    modal === 'create' ? createMut.mutate(form) : updateMut.mutate(form);
  };

  const totalPages = Math.ceil((data?.total || 0) / 15);
  const isBusiness = form.customer_type === 'business';

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">👥 Quản lý Khách hàng</span>
        <button className="btn btn-primary" onClick={openCreate}>+ Thêm khách hàng</button>
      </div>

      <div className="page-content">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Danh sách khách hàng ({data?.total ?? 0})</span>
            <div className="search-box" style={{ minWidth: 280 }}>
              <span>🔍</span>
              <input
                placeholder="Tìm theo tên, SĐT, mã KH, email..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : (data?.data?.length ?? 0) === 0 ? (
              <div className="empty-state"><p>Không có khách hàng nào</p></div>
            ) : (
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th>Mã KH</th>
                    <th>Họ tên</th>
                    <th>Điện thoại</th>
                    <th className="hide-mobile">Email</th>
                    <th className="hide-mobile">Địa chỉ</th>
                    <th>Loại</th>
                    <th className="hide-mobile">Điểm tích lũy</th>
                    <th className="hide-mobile">Ngày tạo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map(c => (
                    <tr key={c.id}>
                      <td><span className="font-mono text-primary">{c.customer_code}</span></td>
                      <td data-label="Họ tên" className="fw-600">{c.full_name}</td>
                      <td data-label="Điện thoại">{c.phone}</td>
                      <td data-label="Email" className="text-muted hide-mobile">{c.email || '-'}</td>
                      <td data-label="Địa chỉ" className="text-muted hide-mobile">
                        {[c.district, c.province].filter(Boolean).join(', ') || c.address || '-'}
                      </td>
                      <td data-label="Loại">
                        <span className={`badge ${c.customer_type === 'business' ? 'badge-blue' : 'badge-gray'}`}>
                          {c.customer_type === 'business' ? '🏢 Doanh nghiệp' : '👤 Cá nhân'}
                        </span>
                      </td>
                      <td data-label="Điểm" className="text-center hide-mobile">{c.loyalty_points}</td>
                      <td data-label="Ngày tạo" className="text-muted hide-mobile">{formatDate(c.created_at)}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>✏️ Sửa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">Trang {page}/{totalPages} · {data?.total} khách hàng</span>
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      {/* Modal thêm / sửa */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {modal === 'create' ? '➕ Thêm khách hàng' : `✏️ Sửa khách hàng — ${editing?.customer_code}`}
              </span>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">

                {/* ── Thông tin cơ bản ── */}
                <p className="form-section-title">Thông tin cơ bản</p>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Họ tên <span className="required">*</span></label>
                    <input
                      className="form-control"
                      required
                      placeholder="Nguyễn Văn A"
                      value={form.full_name}
                      onChange={e => f('full_name', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Số điện thoại <span className="required">*</span></label>
                    <input
                      className="form-control"
                      required
                      placeholder="0901234567"
                      value={form.phone}
                      onChange={e => f('phone', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      className="form-control"
                      type="email"
                      placeholder="example@email.com"
                      value={form.email}
                      onChange={e => f('email', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Loại khách hàng</label>
                    <select
                      className="form-control"
                      value={form.customer_type}
                      onChange={e => f('customer_type', e.target.value as 'individual' | 'business')}
                    >
                      <option value="individual">👤 Cá nhân</option>
                      <option value="business">🏢 Doanh nghiệp</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">CCCD / CMND</label>
                    <input
                      className="form-control"
                      placeholder="012345678901"
                      value={form.id_card}
                      onChange={e => f('id_card', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ngày sinh</label>
                    <input
                      className="form-control"
                      type="date"
                      value={form.date_of_birth}
                      onChange={e => f('date_of_birth', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Giới tính</label>
                    <select
                      className="form-control"
                      value={form.gender}
                      onChange={e => f('gender', e.target.value as any)}
                    >
                      <option value="">— Chọn —</option>
                      <option value="male">Nam</option>
                      <option value="female">Nữ</option>
                      <option value="other">Khác</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nguồn khách hàng</label>
                    <select
                      className="form-control"
                      value={form.source}
                      onChange={e => f('source', e.target.value as any)}
                    >
                      <option value="">— Chọn —</option>
                      <option value="referral">Giới thiệu</option>
                      <option value="facebook">Facebook / MXH</option>
                      <option value="zalo">Zalo</option>
                      <option value="showroom">Vãng lai showroom</option>
                      <option value="website">Website</option>
                      <option value="call_center">Tổng đài</option>
                      <option value="other">Khác</option>
                    </select>
                  </div>
                </div>

                {/* ── CCCD mở rộng ── */}
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Ngày cấp CCCD</label>
                    <input
                      className="form-control"
                      type="date"
                      value={form.id_card_date}
                      onChange={e => f('id_card_date', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nơi cấp CCCD</label>
                    <input
                      className="form-control"
                      placeholder="Cục CSQL HCCD - BCA"
                      value={form.id_card_place}
                      onChange={e => f('id_card_place', e.target.value)}
                    />
                  </div>
                </div>

                {/* ── Địa chỉ giao hàng ── */}
                <p className="form-section-title">Địa chỉ giao hàng</p>
                <div className="form-group">
                  <label className="form-label">Địa chỉ chi tiết <span className="required">*</span></label>
                  <input
                    className="form-control"
                    placeholder="Số nhà, tên đường, phường/xã"
                    value={form.address}
                    onChange={e => f('address', e.target.value)}
                  />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Quận / Huyện</label>
                    <input
                      className="form-control"
                      placeholder="Quận 1"
                      value={form.district}
                      onChange={e => f('district', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tỉnh / Thành phố</label>
                    <input
                      className="form-control"
                      placeholder="TP. Hồ Chí Minh"
                      value={form.province}
                      onChange={e => f('province', e.target.value)}
                    />
                  </div>
                </div>

                {/* ── Thông tin doanh nghiệp (chỉ hiện khi chọn Doanh nghiệp) ── */}
                {isBusiness && (
                  <>
                    <p className="form-section-title">Thông tin doanh nghiệp</p>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Tên công ty <span className="required">*</span></label>
                        <input
                          className="form-control"
                          placeholder="Công ty TNHH ABC"
                          required={isBusiness}
                          value={form.company_name}
                          onChange={e => f('company_name', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Mã số thuế</label>
                        <input
                          className="form-control"
                          placeholder="0123456789"
                          value={form.tax_code}
                          onChange={e => f('tax_code', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Người đại diện pháp lý</label>
                        <input
                          className="form-control"
                          placeholder="Nguyễn Văn A"
                          value={form.representative_name}
                          onChange={e => f('representative_name', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Chức vụ</label>
                        <input
                          className="form-control"
                          placeholder="Giám đốc"
                          value={form.representative_title}
                          onChange={e => f('representative_title', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Địa chỉ xuất hóa đơn */}
                    <p className="form-section-title">Địa chỉ xuất hóa đơn</p>
                    <div className="form-group">
                      <label className="form-label">Địa chỉ</label>
                      <input
                        className="form-control"
                        placeholder="Địa chỉ đăng ký kinh doanh"
                        value={form.invoice_address}
                        onChange={e => f('invoice_address', e.target.value)}
                      />
                    </div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Quận / Huyện</label>
                        <input
                          className="form-control"
                          placeholder="Quận 1"
                          value={form.invoice_district}
                          onChange={e => f('invoice_district', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tỉnh / Thành phố</label>
                        <input
                          className="form-control"
                          placeholder="TP. Hồ Chí Minh"
                          value={form.invoice_province}
                          onChange={e => f('invoice_province', e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* ── Ghi chú ── */}
                <div className="form-group">
                  <label className="form-label">Ghi chú</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="Ghi chú thêm về khách hàng..."
                    value={form.notes}
                    onChange={e => f('notes', e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Huỷ</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMut.isPending || updateMut.isPending}
                >
                  {(createMut.isPending || updateMut.isPending) ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
