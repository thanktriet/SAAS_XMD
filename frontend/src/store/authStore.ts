// Zustand store quản lý Auth state
import { create } from 'zustand';
import type { User } from '../types';
import api from '../services/api';

interface AuthState {
  user:          User | null;
  token:         string | null;
  isLoading:     boolean;
  isInitialized: boolean; // true sau khi init() đọc xong localStorage
  login:               (email: string, password: string) => Promise<void>;
  logout:              () => void;
  init:                () => void;
  refreshAccessToken:  () => Promise<string | null>; // trả token mới hoặc null nếu thất bại
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:          null,
  token:         null,
  isLoading:     false,
  isInitialized: false,

  // Khởi tạo từ localStorage — gọi 1 lần duy nhất khi app mount
  init: () => {
    const token      = localStorage.getItem('token');
    const userStr    = localStorage.getItem('user');
    const expiresAt  = Number(localStorage.getItem('expiresAt') ?? 0);

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        // Token còn hạn (thêm 30 giây đệm) → phục hồi session ngay
        if (expiresAt - 30_000 > Date.now()) {
          set({ token, user, isInitialized: true });
          return;
        }
        // Token đã hết hạn → thử refresh ngầm trước khi khởi tạo xong
        set({ user, isInitialized: false });
        get().refreshAccessToken().then((newToken) => {
          if (!newToken) {
            // Refresh thất bại → xóa session
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('expiresAt');
            set({ user: null, token: null, isInitialized: true });
          } else {
            set({ isInitialized: true });
          }
        });
        return;
      } catch {
        // JSON lỗi → xóa hết
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('expiresAt');
      }
    }
    set({ isInitialized: true });
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token',        data.token);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('expiresAt',    String(data.expiresAt));
      localStorage.setItem('user',         JSON.stringify(data.user));
      set({ token: data.token, user: data.user, isInitialized: true });
    } finally {
      set({ isLoading: false });
    }
  },

  // Dùng refresh token để lấy access token mới — trả về token mới hoặc null
  refreshAccessToken: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return null;
    try {
      const { data } = await api.post('/auth/refresh', { refreshToken });
      localStorage.setItem('token',        data.token);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('expiresAt',    String(data.expiresAt));
      set({ token: data.token });
      return data.token as string;
    } catch {
      return null;
    }
  },

  logout: () => {
    const refreshToken = localStorage.getItem('refreshToken');
    api.post('/auth/logout', { refreshToken }).catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('expiresAt');
    localStorage.removeItem('user');
    set({ user: null, token: null });
  },
}));
