import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';
import { useBrandingStore } from '../../../store/brandingStore';
import { getInitials } from '../../../utils/helpers';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function MobileHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { branding } = useBrandingStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const isRoot = location.pathname === '/m' || location.pathname === '/m/';

  const getTitle = () => {
    const path = location.pathname;
    if (path === '/m' || path === '/m/') return 'Tổng quan';
    if (path === '/m/sales/new') return 'Tạo đơn hàng';
    if (path.startsWith('/m/sales/')) return 'Chi tiết đơn';
    if (path === '/m/sales') return 'Đơn hàng';
    if (path.startsWith('/m/customers/')) return 'Chi tiết khách';
    if (path === '/m/customers') return 'Khách hàng';
    if (path === '/m/notifications') return 'Thông báo';
    return 'XMD';
  };

  const handleLogout = () => {
    logout();
    toast.success('Đã đăng xuất');
    navigate('/m/login');
  };

  return (
    <header className="m-header">
      <div className="m-header-left">
        {!isRoot ? (
          <button
            className="m-header-back"
            onClick={() => navigate(-1)}
            aria-label="Quay lại"
          >
            ←
          </button>
        ) : (
          <span className="m-header-branch">{branding?.branch_name || branding?.store_name || 'XMD'}</span>
        )}
      </div>

      <h1 className="m-header-title">{getTitle()}</h1>

      <div className="m-header-right">
        <button
          className="m-header-avatar"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Menu tài khoản"
        >
          {getInitials(user?.full_name || '?')}
        </button>

        {menuOpen && (
          <>
            <div className="m-header-menu-overlay" onClick={() => setMenuOpen(false)} />
            <div className="m-header-menu">
              <div className="m-header-menu-user">
                <strong>{user?.full_name}</strong>
                <span>{user?.role}</span>
              </div>
              <button onClick={handleLogout} className="m-header-menu-item">
                🚪 Đăng xuất
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
