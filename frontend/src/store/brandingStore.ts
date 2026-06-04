// Zustand store quản lý Branch Branding
import { create } from 'zustand';
import api from '../services/api';

export interface BranchBranding {
  store_name: string;
  subtitle?: string;
  logo_url?: string;
  favicon_url?: string;
  color_primary: string;
  color_primary_dark: string;
  color_primary_light: string;
  color_accent: string;
  hotline?: string;
  support_email?: string;
  website_url?: string;
  branch_name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface BrandingState {
  branding: BranchBranding | null;
  isLoaded: boolean;
  fetchBranding: () => Promise<void>;
  clearBranding: () => void;
}

const DEFAULT_BRANDING: BranchBranding = {
  store_name: 'XMĐ',
  subtitle: 'Hệ Thống Bán Hàng Xe Máy Điện',
  color_primary: '#2563eb',
  color_primary_dark: '#1d4ed8',
  color_primary_light: '#eff6ff',
  color_accent: '#16a34a',
};

function applyThemeToDOM(branding: BranchBranding) {
  const root = document.documentElement;
  root.style.setProperty('--primary', branding.color_primary);
  root.style.setProperty('--primary-dark', branding.color_primary_dark);
  root.style.setProperty('--primary-light', branding.color_primary_light);
  root.style.setProperty('--accent', branding.color_accent);
  // Also set as CSS custom properties for Tailwind-compatible usage
  root.style.setProperty('--color-primary', branding.color_primary);
  root.style.setProperty('--color-primary-dark', branding.color_primary_dark);
  root.style.setProperty('--color-primary-light', branding.color_primary_light);
  root.style.setProperty('--color-accent', branding.color_accent);
}

export const useBrandingStore = create<BrandingState>((set) => ({
  branding: null,
  isLoaded: false,

  fetchBranding: async () => {
    try {
      const res = await api.get('/branding');
      const branding: BranchBranding = {
        ...DEFAULT_BRANDING,
        ...res.data,
      };
      applyThemeToDOM(branding);
      set({ branding, isLoaded: true });
    } catch {
      // Fallback to defaults
      applyThemeToDOM(DEFAULT_BRANDING);
      set({ branding: DEFAULT_BRANDING, isLoaded: true });
    }
  },

  clearBranding: () => {
    set({ branding: null, isLoaded: false });
  },
}));
