import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-detect mobile → suggest redirect /m/
if (
  window.innerWidth < 768 &&
  !navigator.userAgent.includes('Electron') &&
  !localStorage.getItem('prefer-desktop') &&
  !window.location.pathname.startsWith('/m')
) {
  const go = window.confirm('Bạn đang dùng điện thoại. Chuyển sang phiên bản mobile?');
  if (go) {
    window.location.href = '/mobile.html';
  } else {
    localStorage.setItem('prefer-desktop', '1');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
