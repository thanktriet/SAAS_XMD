// Sidebar + Layout chính
import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useBrandingStore } from '../store/brandingStore';
import { getInitials } from '../utils/helpers';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { branding, isLoaded, fetchBranding } = useBrandingStore();

  useEffect(() => {
    if (!isLoaded) fetchBranding();
  }, [isLoaded, fetchBranding]);
  const navigate  = useNavigate();
  const location  = useLocation();

  // ── Trạng thái sidebar ────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('sidebar_collapsed') === 'true'
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Modal đổi mật khẩu ────────────────────────────────────────────
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [oldPwd, setOldPwd]             = useState('');
  const [newPwd, setNewPwd]             = useState('');
  const [confirmPwd, setConfirmPwd]     = useState('');
  const [pwdLoading, setPwdLoading]     = useState(false);

  const isMobile = () => window.innerWidth <= 768;

  // Đóng sidebar mobile khi chuyển trang
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const toggleSidebar = () => {
    if (isMobile()) {
      setMobileOpen(v => !v);
    } else {
      setCollapsed(v => {
        localStorage.setItem('sidebar_collapsed', String(!v));
        return !v;
      });
    }
  };

  const laAdmin          = user?.role === 'admin';
  const laAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  const laSales          = user?.role === 'sales';

  // Sales chỉ thấy 3 mục: Khách hàng, Đơn hàng, Tồn kho xe
  const NAV = laSales ? [
    {
      section: 'Tổng quan',
      items: [{ to: '/', label: 'Dashboard', icon: '📊' }],
    },
    {
      section: 'Kinh doanh',
      items: [
        { to: '/customers', label: 'Khách hàng', icon: '👥' },
        { to: '/sales',     label: 'Đơn hàng',   icon: '🛒' },
      ],
    },
    {
      section: 'Kho & Xe',
      items: [
        { to: '/inventory', label: 'Tồn kho xe', icon: '📦' },
      ],
    },
  ] : [
    {
      section: 'Tổng quan',
      items: [{ to: '/', label: 'Dashboard', icon: '📊' }],
    },
    {
      section: 'Kinh doanh',
      items: [
        { to: '/customers',     label: 'Khách hàng',  icon: '👥' },
        { to: '/sales',         label: 'Đơn hàng',    icon: '🛒' },
      ],
    },
    {
      section: 'Kho & Xe',
      items: [
        ...(laAdmin ? [{ to: '/vehicles', label: 'Mẫu xe', icon: '🏍️' }] : []),
        { to: '/inventory',       label: 'Tồn kho xe',       icon: '📦' },
        { to: '/accessories',     label: 'Phụ kiện',         icon: '🎒' },
        { to: '/gifts',           label: 'Quà tặng',         icon: '🎁' },
        ...(laAdmin ? [{ to: '/promotions', label: 'Khuyến mãi', icon: '🎉' }] : []),
      ],
    },
    {
      section: 'Dịch vụ',
      items: [
        { to: '/services',          label: 'Phiếu dịch vụ',    icon: '🔧' },
        { to: '/accessory-orders',  label: 'Bán phụ kiện',     icon: '🎒' },
        { to: '/battery-rentals',   label: 'Pin thuê',         icon: '🔋' },
      ],
    },
    {
      section: 'Tài chính',
      items: [
        { to: '/finance',             label: 'Thu chi',  icon: '💰' },
        { to: '/cash-advances',       label: 'Phiếu chi', icon: '💵' },
        { to: '/accounting/cashflow', label: 'Tồn quỹ', icon: '🏦' },
        { to: '/reports/daily',       label: 'Báo cáo ngày', icon: '📅' },
      ],
    },
    ...(laAdminOrManager ? [{
      section: 'Quản trị',
      items: [
        { to: '/users',    label: 'Nhân viên', icon: '👤' },
        ...(laAdmin ? [{ to: '/branches', label: 'Chi nhánh', icon: '🏪' }] : []),
        ...(laAdmin ? [{ to: '/license',  label: 'License', icon: '🔑' }] : []),
        ...(laAdmin ? [{ to: '/settings', label: 'Cấu hình', icon: '⚙️' }] : []),
      ],
    }] : []),
  ];

  const handleLogout = () => {
    logout();
    toast.success('Đã đăng xuất');
    navigate('/login');
  };

  const openPwdModal = () => {
    setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    setShowPwdModal(true);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast.error('Vui lòng điền đầy đủ thông tin');
      return;
    }
    if (newPwd.length < 6) {
      toast.error('Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error('Mật khẩu xác nhận không khớp');
      return;
    }
    if (oldPwd === newPwd) {
      toast.error('Mật khẩu mới phải khác mật khẩu cũ');
      return;
    }
    try {
      setPwdLoading(true);
      await api.put('/auth/me/password', { old_password: oldPwd, new_password: newPwd });
      toast.success('Đổi mật khẩu thành công');
      setShowPwdModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Lỗi đổi mật khẩu');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`}>

      {/* Overlay khi mở sidebar trên mobile */}
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar${mobileOpen ? ' sidebar-mobile-open' : ''}`}>

        {/* Logo + nút toggle desktop */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-content">
            {!collapsed && (
              <div className="sidebar-logo-text">
                <h1>{branding?.store_name || 'XMĐ'}</h1>
                <p>Hệ Thống Bán Hàng Xe Máy Điện</p>
              </div>
            )}
          </div>
          <button
            className="sidebar-toggle-btn"
            onClick={toggleSidebar}
            title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(group => (
            <div className="nav-section" key={group.section}>
              {!collapsed && (
                <div className="nav-section-title">{group.section}</div>
              )}
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-item-icon">{item.icon}</span>
                  {!collapsed && <span className="nav-item-label">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar" title={user?.full_name}>
              {getInitials(user?.full_name || '?')}
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.full_name}
                </div>
                <div className="user-role">{user?.role}</div>
              </div>
            )}
            <button
              onClick={openPwdModal}
              title="Đổi mật khẩu"
              style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}
            >
              🔑
            </button>
            <button
              onClick={handleLogout}
              title="Đăng xuất"
              style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* ── Modal đổi mật khẩu ── */}
      {showPwdModal && (
        <div
          onClick={() => !pwdLoading && setShowPwdModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 16,
          }}
        >
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={handleChangePassword}
            style={{
              background: '#fff', borderRadius: 10, padding: 24,
              width: '100%', maxWidth: 420, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: 18 }}>🔑 Đổi mật khẩu</h3>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Mật khẩu hiện tại
              </label>
              <input
                type="password"
                value={oldPwd}
                onChange={e => setOldPwd(e.target.value)}
                autoFocus
                disabled={pwdLoading}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
                  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Mật khẩu mới (≥ 6 ký tự)
              </label>
              <input
                type="password"
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                disabled={pwdLoading}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
                  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Xác nhận mật khẩu mới
              </label>
              <input
                type="password"
                value={confirmPwd}
                onChange={e => setConfirmPwd(e.target.value)}
                disabled={pwdLoading}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
                  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowPwdModal(false)}
                disabled={pwdLoading}
                className="btn btn-secondary"
              >
                Huỷ
              </button>
              <button type="submit" className="btn btn-primary" disabled={pwdLoading}>
                {pwdLoading ? 'Đang đổi...' : 'Đổi mật khẩu'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── MAIN ── */}
      <main className="main-content">
        {/* Mobile topbar — chứa nút hamburger, không che content */}
        <div className="mobile-topbar">
          <button className="mobile-topbar-btn" onClick={toggleSidebar} title="Mở menu">
            ☰
          </button>
          <span className="mobile-topbar-title">{branding?.store_name || 'XMĐ'}</span>
        </div>

        <Outlet />
      </main>
    </div>
  );
}
