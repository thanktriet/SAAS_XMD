// Axios instance với base URL và interceptor tự động gắn token
import axios from 'axios';

/** Redirect login có tiền tố BASE_URL (bắt buộc khi deploy GitHub Pages dưới /repo/) */
function redirectToLoginPage() {
  const b = import.meta.env.BASE_URL;
  window.location.href = b.endsWith('/') ? `${b}login` : `${b}/login`;
}

const rawApiBase = typeof import.meta.env.VITE_API_BASE_URL === 'string'
  ? import.meta.env.VITE_API_BASE_URL.trim()
  : '';
/** Local/Vite proxy: /api. Trên github.io bắt buộc URL tuyệt đối https://.../api */
const API_BASE = rawApiBase || '/api';

if (typeof window !== 'undefined' && API_BASE.startsWith('/') && window.location.hostname.endsWith('github.io')) {
  const mistaken = new URL(API_BASE, window.location.origin).href;
  console.error(
    '[ERP] API đang trỏ tới',
    mistaken,
    '— GitHub Pages không phục vụ Express. 405/404 là do POST tới host sai.\n' +
      '→ Build lại với secret VITE_API_BASE_URL = URL backend public (vd https://ten-mien.com/api).',
  );
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Tự động gắn token vào header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Biến flag tránh gọi refresh nhiều lần cùng lúc (race condition)
let isRefreshing = false;
let waitingQueue: Array<(token: string | null) => void> = [];

function processQueue(newToken: string | null) {
  waitingQueue.forEach((resolve) => resolve(newToken));
  waitingQueue = [];
}

// Xử lý lỗi global: 401 → refresh, 403 license → redirect trang bị khóa
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;
    const errorCode = err.response?.data?.code;

    // 403 — Chi nhánh bị dừng hoặc hết hạn license → force logout + thông báo
    if (err.response?.status === 403 && ['BRANCH_SUSPENDED', 'LICENSE_EXPIRED'].includes(errorCode)) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('expiresAt');
      localStorage.removeItem('user');
      // Lưu thông báo lỗi để trang login hiển thị
      localStorage.setItem('license_error', err.response.data.error || 'Chi nhánh đã bị tạm dừng.');
      localStorage.setItem('license_error_code', errorCode);
      redirectToLoginPage();
      return Promise.reject(err);
    }

    // 429 — Rate limited
    if (err.response?.status === 429) {
      return Promise.reject(err);
    }

    if (err.response?.status === 401) {
      const url    = String(originalRequest?.url ?? '');
      const method = String(originalRequest?.method ?? '').toLowerCase();

      // Sai mật khẩu khi đăng nhập hoặc chính endpoint refresh thất bại
      // → không thử refresh, trả lỗi về cho caller xử lý
      if (
        (url.includes('/auth/login') && method === 'post') ||
        url.includes('/auth/refresh')
      ) {
        return Promise.reject(err);
      }

      // Đã thử refresh rồi vẫn 401 → bỏ cuộc
      if (originalRequest._retry) {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('expiresAt');
        localStorage.removeItem('user');
        redirectToLoginPage();
        return Promise.reject(err);
      }

      // Nếu đang refresh → đưa request vào hàng đợi
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          waitingQueue.push((newToken) => {
            if (newToken) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              resolve(api(originalRequest));
            } else {
              reject(err);
            }
          });
        });
      }

      // Thử refresh token
      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        redirectToLoginPage();
        return Promise.reject(err);
      }

      try {
        const { data } = await api.post('/auth/refresh', { refreshToken });
        const newToken = data.token as string;

        localStorage.setItem('token',        newToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('expiresAt',    String(data.expiresAt));

        // Cập nhật store mà không gây circular import
        // (store cũng tự cập nhật khi interceptor gọi refreshAccessToken)
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;

        processQueue(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch {
        processQueue(null);
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('expiresAt');
        localStorage.removeItem('user');
        redirectToLoginPage();
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  }
);

export default api;
