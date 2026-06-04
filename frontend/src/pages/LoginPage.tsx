// Trang đăng nhập
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

function thongBaoLoiDangNhap(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: string; code?: string; retryAfter?: number } }; message?: string };
  if (!e?.response) {
    return 'Không kết nối được API. Trên GitHub Pages cần cấu hình secret VITE_API_BASE_URL trỏ tới backend (và backend phải bật CORS cho domain Pages).';
  }
  const st = e.response.status;
  const msg = e.response.data?.error;
  const code = e.response.data?.code;

  // License / branch errors
  if (code === 'BRANCH_SUSPENDED' || code === 'LICENSE_EXPIRED') {
    return msg || 'Chi nhánh đã bị tạm dừng hoặc hết hạn sử dụng.';
  }

  // Rate limited
  if (st === 429) {
    return msg || 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.';
  }

  if (msg) return msg;
  if (st === 404) {
    return 'Không tìm thấy API (404). Kiểm tra VITE_API_BASE_URL khi build — không dùng được đường dẫn /api trên github.io.';
  }
  if (st !== undefined && st >= 500) return 'Lỗi máy chủ. Thử lại sau.';
  return 'Email hoặc mật khẩu không đúng';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  // Kiểm tra nếu bị redirect do license hết hạn
  useEffect(() => {
    const error = localStorage.getItem('license_error');
    const errorCode = localStorage.getItem('license_error_code');
    if (error) {
      setLicenseError(error);
      localStorage.removeItem('license_error');
      localStorage.removeItem('license_error_code');

      // Hiện toast cảnh báo
      if (errorCode === 'LICENSE_EXPIRED') {
        toast.error('Quyền sử dụng đã hết hạn. Liên hệ quản trị viên để gia hạn.', { duration: 8000 });
      } else {
        toast.error('Chi nhánh đã bị tạm dừng.', { duration: 8000 });
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLicenseError(null);
    try {
      await login(email, password);
      toast.success('Đăng nhập thành công!');
      navigate('/');
    } catch (err: unknown) {
      const errTyped = err as { response?: { data?: { code?: string; error?: string } } };
      const code = errTyped?.response?.data?.code;

      // Hiển thị lỗi license dạng banner
      if (code === 'BRANCH_SUSPENDED' || code === 'LICENSE_EXPIRED') {
        setLicenseError(errTyped?.response?.data?.error || 'Chi nhánh bị khóa.');
      }

      toast.error(thongBaoLoiDangNhap(err));
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <h1>Hệ Thống Bán Hàng</h1>
          <p>Xe Máy Điện</p>
        </div>

        {/* Banner cảnh báo license */}
        {licenseError && (
          <div
            className="license-error-banner"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              color: '#991b1b',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>⚠️ Không thể đăng nhập</strong>
            {licenseError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email <span className="required">*</span></label>
            <input
              className="form-control"
              type="email"
              placeholder="nhanvien@donvi.vn"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mật khẩu <span className="required">*</span></label>
            <input
              className="form-control"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={isLoading}
            style={{ width: '100%', justifyContent: 'center', padding: '11px' }}
          >
            {isLoading ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Đang đăng nhập...</> : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}
