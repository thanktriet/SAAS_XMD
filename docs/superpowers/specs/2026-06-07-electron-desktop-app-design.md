# Electron Desktop App — XMĐ ERP

**Date:** 2026-06-07  
**Status:** Approved  
**Scope:** Đóng gói React frontend thành file .exe với NSIS installer và auto-update

---

## 1. Kiến trúc tổng thể

```
D:\XMD_SAAS\
├── frontend/          ← React app (không đổi)
│   └── dist/          ← build output, Electron đọc từ đây
├── electron/          ← NEW: Electron wrapper
│   ├── main.js        ← main process (cửa sổ, update, tray)
│   ├── preload.js     ← bridge an toàn giữa renderer và Node
│   ├── package.json   ← electron-builder config
│   └── build/         ← icon .ico, NSIS assets
└── backend-production/
```

**Luồng:**
1. `npm run build` trong `frontend/` → tạo `dist/`
2. `electron-builder` đọc `dist/` + Electron runtime → tạo `XMD-Setup.exe`
3. Upload lên GitHub Releases → `electron-updater` tự phát hiện bản mới

React app vẫn gọi API về VPS qua `VITE_API_URL` — Electron chỉ là vỏ bọc.

---

## 2. Electron main process

### Khởi động
1. Hiện splash screen (logo XMĐ + progress bar)
2. Kiểm tra update từ GitHub Releases
3. Mở cửa sổ chính tải `dist/index.html`
4. Splash screen ẩn sau khi cửa sổ sẵn sàng

### Cửa sổ chính
- Kích thước mặc định: 1280×800, min: 1024×600
- Native frame với icon XMĐ trong taskbar
- Nhớ vị trí + kích thước giữa các lần mở (lưu vào `electron-store`)
- `contextIsolation: true`, `nodeIntegration: false`

### Tray icon
- Tồn tại khi cửa sổ đang mở hoặc bị minimize
- Double click → mở lại cửa sổ
- Right click menu: "Mở XMĐ", separator, "Thoát"

### Auto-update (electron-updater + GitHub Releases)
- Kiểm tra update khi app khởi động
- Dialog: "Có bản cập nhật X.Y.Z — tải về không?"
- Download ngầm với progress bar
- Sau khi tải xong: "Cài ngay" hoặc "Cài lần sau" (cài khi đóng app)

---

## 3. Installer — NSIS Setup Wizard

**Màn hình cài đặt (theo thứ tự):**
1. Màn hình chào — logo XMĐ + tên app + version
2. Chọn thư mục cài (mặc định `C:\Program Files\XMD`)
3. Chọn shortcut: Desktop + Start Menu (tick mặc định)
4. Cài đặt + progress bar
5. Xong — checkbox "Mở XMĐ ngay" → Finish

**electron-builder config:**
```json
{
  "appId": "com.xmd.erp",
  "productName": "XMĐ ERP",
  "icon": "build/icon.ico",
  "win": { "target": "nsis" },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  },
  "publish": {
    "provider": "github",
    "repo": "SAAS_XMD",
    "owner": "thanktriet"
  }
}
```

---

## 4. Build pipeline

```bash
# Bước 1: build React app (với base ./ cho Electron)
cd frontend
VITE_API_URL=https://<vps-url>/api npm run build

# Bước 2: đóng gói Electron
cd ../electron
npm run dist
# → output: electron/dist/XMD-Setup-1.0.0.exe
```

### Vite config thay đổi
Thêm điều kiện khi build cho Electron:
```ts
base: process.env.ELECTRON ? './' : '/'
```

### Biến môi trường
| Biến | Giá trị |
|------|---------|
| `VITE_API_URL` | URL API production (VPS) |
| `ELECTRON` | `1` khi build cho Electron |

---

## 5. Dependencies cần thêm

**`electron/package.json`:**
- `electron` — runtime
- `electron-builder` — đóng gói + installer
- `electron-updater` — auto-update
- `electron-store` — lưu window state

---

## 6. Cấu trúc file electron/

```
electron/
├── main.js          ← BrowserWindow, tray, IPC handlers, auto-updater
├── preload.js       ← contextBridge expose APIs an toàn
├── package.json     ← app metadata + electron-builder config
└── build/
    ├── icon.ico     ← 256x256 Windows icon
    └── icon.png     ← 512x512 cho Linux/Mac (tùy chọn)
```

---

## 7. Không nằm trong scope

- macOS / Linux build (chỉ Windows)
- Offline mode (API luôn cần internet)
- Code signing certificate (có thể thêm sau nếu cần bypass SmartScreen)
