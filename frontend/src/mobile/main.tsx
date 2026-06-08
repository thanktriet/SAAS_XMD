import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './mobile.css'
import App from './App'
import { registerSW } from './sw/register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register service worker in production
if (import.meta.env.PROD) {
  registerSW();
}
