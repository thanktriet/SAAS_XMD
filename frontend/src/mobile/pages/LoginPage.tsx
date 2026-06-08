import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Vui lòng nhập email và mật khẩu');
      return;
    }
    try {
      setLoading(true);
      await login(email, password);
      navigate('/m', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m-login">
      <div className="m-login-card">
        <div className="m-login-header">
          <h1>XMD Sales</h1>
          <p>Đăng nhập để tiếp tục</p>
        </div>

        <form onSubmit={handleSubmit} className="m-login-form">
          <div className="m-input-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com"
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="m-input-group">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <button type="submit" className="m-btn-primary" disabled={loading}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}
