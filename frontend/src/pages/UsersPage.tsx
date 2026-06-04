import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';

// ─── Hằng số ──────────────────────────────────────────────────────────────────
const VAI_TRO_NHAN = {
  admin:       'Admin',
  manager:     'Quản lý',
  sales:       'Kinh doanh',
  technician:  'Kỹ thuật',
  accountant:  'Kế toán',
  warehouse:   'Kho',
} as const;

const VAI_TRO_MAU: Record<string, string> = {
  admin:      '#dc2626',
  manager:    '#7c3aed',
  sales:      '#2563eb',
  technician: '#059669',
  accountant: '#d97706',
  warehouse:  '#6b7280',
};

// ─── Types nội bộ ─────────────────────────────────────────────────────────────
interface UserForm {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  role: User['role'];
  branch_id: string;
}

const formRong = (): UserForm => ({
  email: '', password: '', full_name: '', phone: '', role: 'sales', branch_id: '',
});

// ─── Component badge vai trò ──────────────────────────────────────────────────
function BadgeVaiTro({ role }: { role: string }) {
  const nhan = VAI_TRO_NHAN[role as keyof typeof VAI_TRO_NHAN] ?? role;
  const mau  = VAI_TRO_MAU[role] ?? '#6b7280';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      fontSize: 12, fontWeight: 600,
      background: mau + '22', color: mau, border: `1px solid ${mau}44`,
    }}>
      {nhan}
    </span>
  );
}

// ─── Input đẹp dùng cho modal ─────────────────────────────────────────────────
type InputDepProps = React.InputHTMLAttributes<HTMLInputElement> & {
  icon?: string;
  label: string;
  required?: boolean;
};
function InputDep({ icon, label, required, ...rest }: InputDepProps) {
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(false);
  const borderColor = focused ? '#2563eb' : hover ? '#9ca3af' : '#e5e7eb';

  return (
    <div>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 600,
        color: '#6b7280', marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 14px', height: 44,
          background: '#fff',
          border: `1.5px solid ${borderColor}`, borderRadius: 10,
          transition: 'all 0.15s ease',
          boxShadow: focused
            ? '0 0 0 4px rgba(37, 99, 235, 0.12)'
            : '0 1px 2px rgba(0, 0, 0, 0.03)',
        }}
      >
        {icon && (
          <span style={{ fontSize: 16, color: focused ? '#2563eb' : '#9ca3af', transition: 'color 0.15s' }}>
            {icon}
          </span>
        )}
        <input
          {...rest}
          required={required}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 14, color: '#111827', height: '100%',
            ...rest.style,
          }}
        />
      </div>
    </div>
  );
}

// ─── Trang chính ──────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { user: toi } = useAuthStore();
  const qc = useQueryClient();

  const [search, setSearch]         = useState('');
  const [locVaiTro, setLocVaiTro]   = useState('');
  const [hienModal, setHienModal]   = useState(false);
  const [dangSua, setDangSua]       = useState<User | null>(null);
  const [form, setForm]             = useState<UserForm>(formRong());
  const [hienMatKhau, setHienMK]    = useState(false);   // modal đổi mật khẩu
  const [matKhauMoi, setMKMoi]      = useState('');
  const [idDoiMK, setIdDoiMK]       = useState('');

  // Truy vấn danh sách nhân viên
  const { data, isLoading } = useQuery({
    queryKey: ['users', search, locVaiTro],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search)    params.search = search;
      if (locVaiTro) params.role   = locVaiTro;
      const res = await api.get('/auth/users', { params });
      return res.data as { data: User[]; total: number };
    },
  });

  // Truy vấn danh sách chi nhánh
  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await api.get('/branding/branches');
      return (res.data.data || []) as { id: string; branch_name: string; branch_code: string }[];
    },
  });

  // Mutation tạo nhân viên
  const taoNV = useMutation({
    mutationFn: (body: UserForm) => api.post('/auth/users', body),
    onSuccess: () => {
      toast.success('Đã tạo tài khoản nhân viên');
      qc.invalidateQueries({ queryKey: ['users'] });
      dongModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi tạo tài khoản'),
  });

  // Mutation cập nhật nhân viên
  const suaNV = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UserForm> }) =>
      api.put(`/auth/users/${id}`, body),
    onSuccess: () => {
      toast.success('Đã cập nhật thông tin');
      qc.invalidateQueries({ queryKey: ['users'] });
      dongModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi cập nhật'),
  });

  // Mutation bật/tắt tài khoản
  const batTat = useMutation({
    mutationFn: (id: string) => api.patch(`/auth/users/${id}/toggle`),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi thay đổi trạng thái'),
  });

  // Mutation đổi mật khẩu
  const doiMK = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.put(`/auth/users/${id}/password`, { password }),
    onSuccess: (res) => {
      toast.success(res.data.message);
      dongModalMK();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi đổi mật khẩu'),
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const moTaoMoi = () => { setDangSua(null); setForm(formRong()); setHienModal(true); };
  const moChinhSua = (u: User) => {
    setDangSua(u);
    setForm({ email: u.email, password: '', full_name: u.full_name, phone: u.phone || '', role: u.role, branch_id: u.branch_id || '' });
    setHienModal(true);
  };
  const dongModal = () => { setHienModal(false); setDangSua(null); setForm(formRong()); };
  const moDoiMK = (u: User) => { setIdDoiMK(u.id); setMKMoi(''); setHienMK(true); };
  const dongModalMK = () => { setHienMK(false); setIdDoiMK(''); setMKMoi(''); };

  const guiForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (dangSua) {
      const { email: _e, password: _p, ...rest } = form;
      suaNV.mutate({ id: dangSua.id, body: rest });
    } else {
      taoNV.mutate(form);
    }
  };

  const nguoiDung = data?.data ?? [];
  const laAdmin   = toi?.role === 'admin';

  return (
    <div className="page-container">
      {/* Tiêu đề */}
      <div className="page-header">
        <div>
          <h1 className="page-title">👤 Quản lý nhân viên</h1>
          <p className="page-subtitle">Danh sách tài khoản nhân viên & phân quyền</p>
        </div>
        {laAdmin && (
          <button className="btn btn-primary" onClick={moTaoMoi}>
            + Thêm nhân viên
          </button>
        )}
      </div>

      {/* Bộ lọc */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Tìm theo tên, email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 160 }}
            value={locVaiTro}
            onChange={e => setLocVaiTro(e.target.value)}
          >
            <option value="">Tất cả vai trò</option>
            {Object.entries(VAI_TRO_NHAN).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bảng danh sách */}
      <div className="card">
        {isLoading ? (
          <div className="loading-spinner" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Email</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                {laAdmin && <th style={{ textAlign: 'right' }}>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {nguoiDung.length === 0 ? (
                <tr><td colSpan={laAdmin ? 6 : 5} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>
                  Không có nhân viên nào
                </td></tr>
              ) : nguoiDung.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: VAI_TRO_MAU[u.role] + '33',
                        color: VAI_TRO_MAU[u.role],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 14,
                      }}>
                        {u.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{u.full_name}</div>
                        {u.phone && <div style={{ fontSize: 12, color: '#6b7280' }}>{u.phone}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: '#6b7280', fontSize: 14 }}>{u.email}</td>
                  <td><BadgeVaiTro role={u.role} /></td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                      fontSize: 12, fontWeight: 600,
                      background: u.is_active ? '#dcfce733' : '#fee2e233',
                      color: u.is_active ? '#16a34a' : '#dc2626',
                      border: `1px solid ${u.is_active ? '#86efac' : '#fca5a5'}`,
                    }}>
                      {u.is_active ? 'Đang hoạt động' : 'Vô hiệu hóa'}
                    </span>
                  </td>
                  <td style={{ color: '#6b7280', fontSize: 13 }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  {laAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => moChinhSua(u)}>
                          Sửa
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={() => moDoiMK(u)}>
                          Mật khẩu
                        </button>
                        {u.id !== toi?.id && (
                          <button
                            className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-success'}`}
                            onClick={() => batTat.mutate(u.id)}
                            disabled={batTat.isPending}
                          >
                            {u.is_active ? 'Tắt' : 'Bật'}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <div style={{ padding: '8px 16px', color: '#6b7280', fontSize: 13, borderTop: '1px solid #f3f4f6' }}>
            Tổng: {data.total} nhân viên
          </div>
        )}
      </div>

      {/* ── Modal tạo/sửa nhân viên ── */}
      {hienModal && (
        <div className="modal-overlay" onClick={dongModal}>
          <div className="modal" style={{ width: 560, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid #f3f4f6', padding: '16px 20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18 }}>
                  {dangSua ? 'Cập nhật nhân viên' : 'Thêm nhân viên mới'}
                </h3>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  {dangSua
                    ? `Đang sửa: ${dangSua.full_name}`
                    : 'Tạo tài khoản đăng nhập cho nhân viên mới'}
                </div>
              </div>
              <button className="modal-close" onClick={dongModal}>✕</button>
            </div>
            <form onSubmit={guiForm}>
              <div className="modal-body" style={{ padding: '20px' }}>
                {/* Avatar preview */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', marginBottom: 18,
                  background: 'linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%)',
                  borderRadius: 10, border: '1px solid #e5e7eb',
                }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: VAI_TRO_MAU[form.role] + '33',
                    color: VAI_TRO_MAU[form.role],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 24,
                    border: `2px solid ${VAI_TRO_MAU[form.role]}55`,
                  }}>
                    {form.full_name.trim().charAt(0).toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {form.full_name.trim() || 'Tên nhân viên'}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <BadgeVaiTro role={form.role} />
                    </div>
                  </div>
                </div>

                {/* Email + Mật khẩu — chỉ hiện khi tạo mới */}
                {!dangSua && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                    <InputDep
                      label="Email" required icon="✉️" type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="nhanvien@cty.com"
                    />
                    <InputDep
                      label="Mật khẩu" required icon="🔒" type="password" minLength={6}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="≥ 6 ký tự"
                    />
                  </div>
                )}

                {/* Họ và tên + SĐT */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 14 }}>
                  <InputDep
                    label="Họ và tên" required icon="👤"
                    value={form.full_name}
                    onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="Nguyễn Văn A"
                  />
                  <InputDep
                    label="Số điện thoại" icon="📞" type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="0901234567"
                  />
                </div>

                {/* Vai trò — chip selector */}
                <div>
                  <label style={{
                    display: 'block', fontSize: 12, fontWeight: 600,
                    color: '#6b7280', marginBottom: 6,
                    textTransform: 'uppercase', letterSpacing: 0.3,
                  }}>
                    Vai trò <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {Object.entries(VAI_TRO_NHAN).map(([k, v]) => {
                      const dangChon = form.role === k;
                      const mau = VAI_TRO_MAU[k];
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, role: k as User['role'] }))}
                          style={{
                            padding: '11px 12px', borderRadius: 10, cursor: 'pointer',
                            background: dangChon ? mau + '18' : '#fff',
                            color: dangChon ? mau : '#374151',
                            border: `1.5px solid ${dangChon ? mau : '#e5e7eb'}`,
                            fontWeight: dangChon ? 600 : 500, fontSize: 13,
                            transition: 'all 0.15s ease',
                            textAlign: 'center',
                            boxShadow: dangChon ? `0 0 0 3px ${mau}22` : 'none',
                          }}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Chi nhánh */}
                <div>
                  <label style={{
                    display: 'block', fontSize: 12, fontWeight: 600,
                    color: '#6b7280', marginBottom: 6,
                    textTransform: 'uppercase', letterSpacing: 0.3,
                  }}>
                    Chi nhánh <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <select
                    value={form.branch_id}
                    onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                    required
                    style={{
                      width: '100%', padding: '11px 14px', fontSize: 14,
                      border: '1.5px solid #e5e7eb', borderRadius: 10,
                      outline: 'none', background: '#fff', color: '#111827',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">-- Chọn chi nhánh --</option>
                    {(branchesData || []).map(b => (
                      <option key={b.id} value={b.id}>{b.branch_name} ({b.branch_code})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f3f4f6', padding: '14px 20px', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={dongModal}>Hủy</button>
                <button type="submit" className="btn btn-primary"
                  disabled={taoNV.isPending || suaNV.isPending}>
                  {(taoNV.isPending || suaNV.isPending) ? 'Đang lưu...' : (dangSua ? 'Lưu thay đổi' : 'Tạo tài khoản')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal đổi mật khẩu ── */}
      {hienMatKhau && (
        <div className="modal-overlay" onClick={dongModalMK}>
          <div className="modal" style={{ width: 420, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid #f3f4f6', padding: '16px 20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18 }}>Đổi mật khẩu</h3>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  Cấp mật khẩu mới cho nhân viên
                </div>
              </div>
              <button className="modal-close" onClick={dongModalMK}>✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); doiMK.mutate({ id: idDoiMK, password: matKhauMoi }); }}>
              <div className="modal-body" style={{ padding: '20px' }}>
                <InputDep
                  label="Mật khẩu mới" required icon="🔒" type="password" minLength={6}
                  value={matKhauMoi}
                  onChange={e => setMKMoi(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  autoFocus
                />
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f3f4f6', padding: '14px 20px', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={dongModalMK}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={doiMK.isPending}>
                  {doiMK.isPending ? 'Đang đổi...' : 'Đổi mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
