# Tauri Desktop App — XMĐ ERP

**Date:** 2026-06-07  
**Status:** Approved  
**Scope:** Thay Electron bằng Tauri — native title bar, file .exe nhỏ (~8MB), giữ nguyên web app không đổi

---

## 1. Kiến trúc tổng thể

Tauri wrapper đọc `frontend/dist/` (React app đã build). Rust main process quản lý cửa sổ. React app gọi API về `http://14.225.198.127:8088/api`. Tauri CLI build NSIS installer.

```
D:\XMD_SAAS\
├── frontend/           ← React app (không đổi gì với web)
│   └── dist/           ← build output, Tauri đọc từ đây
├── tauri/              ← NEW: Tauri wrapper
│   └── src-tauri/
│       ├── src/main.rs       ← Rust main process (minimal)
│       ├── Cargo.toml        ← Rust dependencies
│       └── tauri.conf.json   ← config cửa sổ, installer, bundle
├── electron/           ← giữ lại, không xóa
└── backend-production/
```

**Điểm then chốt:**
- Title bar là native OS Windows — trắng mặc định Windows 10/11
- File .exe ~8MB (so với ~80MB của Electron) vì dùng WebView2 có sẵn trên Windows
- `window.__TAURI__` chỉ tồn tại trong Tauri — web browser trả về `undefined`, không có code Tauri nào chạy

---

## 2. Cấu hình cửa sổ

| Thuộc tính | Giá trị |
|-----------|---------|
| Title | XMĐ ERP |
| Width mặc định | 1280 |
| Height mặc định | 800 |
| Min width | 1024 |
| Min height | 600 |
| Title bar | Native Windows (trắng) |
| Fullscreen | false |
| Resizable | true |

Plugin `tauri-plugin-window-state` lưu/phục hồi vị trí và kích thước cửa sổ giữa các lần mở.

---

## 3. Build pipeline

### Dev
```bash
cd tauri
npm run tauri dev
# Tauri tự khởi động vite dev server trên port 1420, mở cửa sổ native
```

### Production
```bash
cd tauri
npm run tauri build
# → src-tauri/target/release/bundle/nsis/XMĐ ERP_1.0.0_x64-setup.exe
```

Tauri CLI tự động build frontend (`npm run build`) trước khi bundle Rust.

### Biến môi trường build
`vite.config.ts` dùng `process.env.TAURI_ENV_DEBUG` (có sẵn khi `tauri build` chạy) để set `base: './'`.

---

## 4. Cấu trúc file tauri/

```
tauri/
├── package.json          ← scripts: tauri dev, tauri build
└── src-tauri/
    ├── src/
    │   └── main.rs       ← #![cfg_attr] + tauri::Builder minimal
    ├── Cargo.toml        ← tauri + tauri-plugin-window-state
    ├── build.rs          ← tauri build script (boilerplate)
    ├── icons/            ← icon.ico + icon.png (256x256)
    └── tauri.conf.json   ← app config
```

---

## 5. tauri.conf.json

```json
{
  "productName": "XMĐ ERP",
  "version": "1.0.0",
  "identifier": "com.xmd.erp",
  "build": {
    "beforeBuildCommand": "npm run build:tauri",
    "frontendDist": "../frontend/dist"
  },
  "app": {
    "windows": [{
      "title": "XMĐ ERP",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 600,
      "resizable": true,
      "fullscreen": false
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/icon.ico", "icons/icon.png"],
    "windows": {
      "nsis": {
        "languages": ["Vietnamese"],
        "displayLanguageSelector": false
      }
    }
  }
}
```

---

## 6. frontend/package.json — script mới

```json
"build:tauri": "cross-env TAURI=1 VITE_API_BASE_URL=http://14.225.198.127:8088/api tsc -b && cross-env TAURI=1 VITE_API_BASE_URL=http://14.225.198.127:8088/api vite build"
```

---

## 7. vite.config.ts — thay đổi

```ts
base: (process.env.ELECTRON === '1' || process.env.TAURI === '1') ? './' : '/',
```

---

## 8. Tương thích web — không đổi gì

- `App.tsx` không cần sửa — `HashRouter` trigger khi `BASE_URL === './'`
- Web build (`npm run build`) vẫn dùng `base: '/'`, không bị ảnh hưởng
- Không import bất kỳ Tauri API nào vào React code — không cần guard `window.__TAURI__`

---

## 9. Không nằm trong scope

- Auto-update (thêm sau với `tauri-plugin-updater`)
- System tray (thêm sau)
- macOS / Linux build
- Splash screen (cửa sổ native load nhanh, không cần)
