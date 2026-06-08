import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import BottomNav from './BottomNav';
import MobileHeader from './MobileHeader';
import FAB from './FAB';
import OfflineBadge from '../ui/OfflineBadge';

export default function MobileLayout() {
  const location = useLocation();
  const [scrollDir, setScrollDir] = useState<'up' | 'down'>('up');

  // Detect scroll direction for FAB hide/show
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrollDir(y > lastY && y > 60 ? 'down' : 'up');
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Hide FAB on sales/new page
  const hideFAB = location.pathname.includes('/m/sales/new');

  return (
    <div className="m-shell">
      <MobileHeader />
      <OfflineBadge />
      <main className="m-content">
        <Outlet />
      </main>
      {!hideFAB && <FAB visible={scrollDir === 'up'} />}
      <BottomNav />
    </div>
  );
}
