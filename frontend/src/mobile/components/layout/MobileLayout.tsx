import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import BottomNav from './BottomNav';
import MobileHeader from './MobileHeader';
import FAB from './FAB';
import OfflineBadge from '../ui/OfflineBadge';
import { usePushNotification } from '../../hooks/usePushNotification';

export default function MobileLayout() {
  const location = useLocation();
  const [scrollDir, setScrollDir] = useState<'up' | 'down'>('up');
  const { isSupported, isSubscribed, subscribe } = usePushNotification();

  // Auto-prompt push notification after login (once)
  useEffect(() => {
    if (isSupported && !isSubscribed) {
      // Delay 3s to not block initial render
      const timer = setTimeout(() => {
        subscribe();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isSupported, isSubscribed, subscribe]);

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

  // Hide global FAB on pages that have their own action bar or form
  const hideFAB = location.pathname.includes('/m/sales/new') ||
    location.pathname.includes('/m/customers') ||
    /\/m\/sales\/[^/]+$/.test(location.pathname); // sales detail has its own action bar

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
