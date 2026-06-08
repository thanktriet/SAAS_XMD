import { NavLink, useLocation } from 'react-router-dom';

const TABS = [
  { to: '/m',              icon: '🏠', label: 'Tổng quan', end: true },
  { to: '/m/sales',       icon: '📋', label: 'Đơn hàng', end: false },
  { to: '/m/customers',   icon: '👥', label: 'Khách hàng', end: false },
  { to: '/m/notifications', icon: '🔔', label: 'Thông báo', end: false },
];

export default function BottomNav() {
  const location = useLocation();

  // Hide on sales/new wizard (full-screen experience)
  if (location.pathname.includes('/m/sales/new')) return null;

  return (
    <nav className="m-bottom-nav" aria-label="Navigation chính">
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `m-nav-tab${isActive ? ' active' : ''}`}
        >
          <span className="m-nav-tab-icon">{tab.icon}</span>
          <span className="m-nav-tab-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
