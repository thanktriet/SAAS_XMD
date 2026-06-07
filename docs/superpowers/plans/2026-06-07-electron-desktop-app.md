# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng gói React frontend thành file .exe với NSIS installer, splash screen, tray icon, và auto-update qua GitHub Releases.

**Architecture:** Electron wrapper đọc `frontend/dist/` (React app đã build). Main process quản lý cửa sổ, tray, auto-updater. React app gọi API về `http://14.225.198.127:8088/api` qua `VITE_API_BASE_URL`. electron-builder tạo NSIS installer và electron-updater kiểm tra GitHub Releases khi khởi động.

**Tech Stack:** Electron 33, electron-builder 25, electron-updater 6, electron-store 10, Vite (frontend build), NSIS (installer)

---

## File Structure

**Tạo mới:**
- `electron/main.js` — BrowserWindow, splash, tray, auto-updater, window state
- `electron/preload.js` — contextBridge (chỉ expose những gì cần thiết)
- `electron/package.json` — app metadata + electron-builder config
- `electron/build/icon.ico` — icon Windows 256x256 (placeholder, thay bằng icon thật)
- `frontend/.env.electron` — biến môi trường khi build cho Electron
- `frontend/electron-build.js` — script build frontend cho Electron (set base='./')

**Sửa đổi:**
- `frontend/vite.config.ts` — hỗ trợ `base: './'` khi `ELECTRON=1`
- `frontend/src/services/api.ts` — không cần sửa (đã đọc `VITE_API_BASE_URL`)
- `.gitignore` — thêm `electron/dist/`, `electron/node_modules/`

---

## Task 1: Khởi tạo thư mục electron/ và cài dependencies

**Files:**
- Create: `electron/package.json`
- Modify: `.gitignore`

- [ ] **Bước 1: Tạo electron/package.json**

```json
{
  "name": "xmd-erp-desktop",
  "version": "1.0.0",
  "description": "XMĐ ERP Desktop App",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win",
    "dist:dir": "electron-builder --win --dir"
  },
  "build": {
    "appId": "com.xmd.erp",
    "productName": "XMĐ ERP",
    "copyright": "Copyright © 2026 XMĐ",
    "directories": {
      "output": "dist",
      "buildResources": "build"
    },
    "files": [
      "main.js",
      "preload.js",
      "../frontend/dist/**/*"
    ],
    "extraMetadata": {
      "main": "main.js"
    },
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "XMĐ ERP",
      "installerIcon": "build/icon.ico",
      "uninstallerIcon": "build/icon.ico",
      "installerHeaderIcon": "build/icon.ico",
      "deleteAppDataOnUninstall": false
    },
    "publish": {
      "provider": "github",
      "owner": "thanktriet",
      "repo": "SAAS_XMD",
      "releaseType": "release"
    }
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  },
  "dependencies": {
    "electron-store": "^10.0.0",
    "electron-updater": "^6.0.0"
  }
}
```

- [ ] **Bước 2: Cài dependencies**

```bash
cd electron
npm install
```

Kết quả mong đợi: `node_modules/` được tạo, không có lỗi.

- [ ] **Bước 3: Cập nhật .gitignore**

Thêm vào cuối file `.gitignore` ở root:

```
electron/dist/
electron/node_modules/
frontend/.env.electron
```

- [ ] **Bước 4: Commit**

```bash
git add electron/package.json .gitignore
git commit -m "chore: khởi tạo electron wrapper project"
```

---

## Task 2: Tạo preload.js (bridge an toàn)

**Files:**
- Create: `electron/preload.js`

- [ ] **Bước 1: Tạo electron/preload.js**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, progress) => cb(progress)),
});
```

- [ ] **Bước 2: Commit**

```bash
git add electron/preload.js
git commit -m "feat: thêm preload bridge cho Electron IPC"
```

---

## Task 3: Tạo main.js — cửa sổ chính và splash screen

**Files:**
- Create: `electron/main.js`

- [ ] **Bước 1: Tạo electron/main.js**

```js
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store();

let mainWindow = null;
let splashWindow = null;
let tray = null;

// Tắt logging mặc định của autoUpdater trong prod
autoUpdater.logger = null;

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    show: true,
    webPreferences: { contextIsolation: true },
  });

  splashWindow.loadURL(`data:text/html,
    <html>
    <body style="margin:0;background:#1e40af;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:white;">
      <div style="font-size:48px;font-weight:bold;margin-bottom:8px">XMĐ</div>
      <div style="font-size:16px;opacity:0.8;margin-bottom:32px">Hệ Thống Quản Lý ERP</div>
      <div style="width:200px;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;">
        <div id="bar" style="width:0%;height:100%;background:white;border-radius:2px;transition:width 0.3s"></div>
      </div>
      <div style="margin-top:12px;font-size:12px;opacity:0.6">Đang khởi động...</div>
      <script>
        let p = 0;
        const bar = document.getElementById('bar');
        const t = setInterval(() => { p = Math.min(p + Math.random() * 15, 85); bar.style.width = p + '%'; if (p >= 85) clearInterval(t); }, 200);
      </script>
    </body>
    </html>
  `);
}

function createMainWindow() {
  const bounds = store.get('windowBounds', { width: 1280, height: 800, x: undefined, y: undefined });

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    title: 'XMĐ ERP',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const distPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  mainWindow.loadFile(distPath);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    checkForUpdates();
  });

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function saveBounds() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    store.set('windowBounds', mainWindow.getBounds());
  }
}

function createTray() {
  // Dùng icon trắng đơn giản nếu chưa có icon.ico
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('XMĐ ERP');

  const menu = Menu.buildFromTemplate([
    { label: 'Mở XMĐ ERP', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Thoát', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch(() => {});
}

autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update-available', info);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Có bản cập nhật mới',
    message: `Bản ${info.version} đã sẵn sàng. Tải về ngay?`,
    buttons: ['Tải về', 'Để sau'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.downloadUpdate();
  });
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) mainWindow.webContents.send('update-progress', progress);
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Cập nhật sẵn sàng',
    message: 'Cài đặt xong. Khởi động lại để áp dụng?',
    buttons: ['Cài ngay', 'Cài lần sau'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      app.isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.on('install-update', () => { app.isQuitting = true; autoUpdater.quitAndInstall(); });

app.whenReady().then(() => {
  createSplash();
  createMainWindow();
  createTray();
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
```

- [ ] **Bước 2: Kiểm tra syntax**

```bash
cd electron
node --check main.js
```

Kết quả mong đợi: không có output (không có lỗi syntax).

- [ ] **Bước 3: Commit**

```bash
git add electron/main.js
git commit -m "feat: thêm Electron main process với splash, tray, auto-update"
```

---

## Task 4: Tạo icon placeholder và cấu hình Vite cho Electron

**Files:**
- Create: `electron/build/` (thư mục)
- Modify: `frontend/vite.config.ts`
- Create: `frontend/.env.electron`

- [ ] **Bước 1: Tạo thư mục build và icon placeholder**

Tạo thư mục `electron/build/`. Bỏ vào đó file `icon.ico` (256x256 Windows icon). Nếu chưa có icon thật, dùng bất kỳ `.ico` nào làm placeholder — electron-builder sẽ báo lỗi nếu thiếu file này.

> Lưu ý: File icon.ico cần ít nhất kích thước 256x256. Có thể dùng công cụ online như https://icoconvert.com để convert từ PNG.

- [ ] **Bước 2: Sửa frontend/vite.config.ts để hỗ trợ base='./'**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: process.env.ELECTRON === '1' ? './' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    allowedHosts: ['unforsaken-unpulped-douglas.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Bước 3: Tạo frontend/.env.electron**

```
VITE_API_BASE_URL=http://14.225.198.127:8088/api
ELECTRON=1
```

- [ ] **Bước 4: Commit**

```bash
git add frontend/vite.config.ts frontend/.env.electron
git commit -m "feat: hỗ trợ base='./' khi build cho Electron"
```

---

## Task 5: Thêm script build và thử build thử

**Files:**
- Modify: `frontend/package.json`
- Create: `build-electron.sh` (script tiện ích)

- [ ] **Bước 1: Thêm script build:electron vào frontend/package.json**

Trong `frontend/package.json`, thêm vào `scripts`:

```json
"build:electron": "dotenv -e .env.electron -- tsc -b && dotenv -e .env.electron -- vite build"
```

Hoặc nếu không muốn dùng dotenv CLI, sửa đơn giản hơn bằng cách đặt biến inline:

```json
"build:electron": "cross-env ELECTRON=1 VITE_API_BASE_URL=http://14.225.198.127:8088/api tsc -b && cross-env ELECTRON=1 VITE_API_BASE_URL=http://14.225.198.127:8088/api vite build"
```

Cài thêm `cross-env`:

```bash
cd frontend
npm install --save-dev cross-env
```

- [ ] **Bước 2: Build frontend cho Electron**

```bash
cd frontend
npm run build:electron
```

Kết quả mong đợi: thư mục `frontend/dist/` được tạo, file `index.html` bên trong bắt đầu bằng relative paths (`./assets/...` thay vì `/assets/...`).

Kiểm tra nhanh:
```bash
head -5 frontend/dist/index.html
```

Phải thấy `src="./assets/` không phải `src="/assets/`.

- [ ] **Bước 3: Chạy thử Electron (không cần build installer)**

```bash
cd electron
npx electron .
```

Kết quả mong đợi: cửa sổ Electron mở ra, load React app, hiện trang login XMĐ. Nếu thấy trang trắng hoặc lỗi — xem DevTools (Ctrl+Shift+I) để debug.

- [ ] **Bước 4: Commit**

```bash
git add frontend/package.json
git commit -m "feat: thêm script build:electron cho frontend"
```

---

## Task 6: Build installer .exe

**Files:**
- Không có file mới — chạy electron-builder

- [ ] **Bước 1: Build frontend trước**

```bash
cd frontend
npm run build:electron
```

- [ ] **Bước 2: Chạy electron-builder**

```bash
cd electron
npm run dist
```

Quá trình này tải Electron runtime lần đầu (~100MB), sẽ mất 5-10 phút. Kết quả mong đợi: file `electron/dist/XMĐ ERP Setup 1.0.0.exe` được tạo.

- [ ] **Bước 3: Kiểm tra installer**

Chạy file `XMĐ ERP Setup 1.0.0.exe`:
1. Màn hình chào hiện ra với tên "XMĐ ERP"
2. Có thể chọn thư mục cài
3. Có tùy chọn tạo shortcut Desktop + Start Menu
4. Sau khi cài, app mở ra với splash screen rồi load trang login

- [ ] **Bước 4: Commit**

```bash
git add electron/package.json
git commit -m "feat: hoàn thiện Electron installer build pipeline"
```

---

## Task 7: Cấu hình auto-update với GitHub Releases

**Files:**
- Modify: `electron/main.js` — không cần sửa (đã có auto-update từ Task 3)

- [ ] **Bước 1: Tạo GitHub Release**

Trên GitHub repo `thanktriet/SAAS_XMD`, tạo Release mới:
- Tag: `v1.0.0`
- Title: `XMĐ ERP v1.0.0`
- Upload file `electron/dist/XMĐ ERP Setup 1.0.0.exe`
- Upload file `electron/dist/latest.yml` (electron-builder tạo tự động)

> Lưu ý: File `latest.yml` bắt buộc phải có — đây là file electron-updater đọc để biết version mới.

- [ ] **Bước 2: Kiểm tra auto-update hoạt động**

Để test auto-update:
1. Build bản `1.0.0`, cài lên máy test
2. Đổi version trong `electron/package.json` thành `1.0.1`
3. Build lại `npm run dist`
4. Upload file mới lên GitHub Release với tag `v1.0.1`
5. Mở bản `1.0.0` đã cài — sau vài giây sẽ hiện dialog "Có bản cập nhật mới"

- [ ] **Bước 3: Commit version bump**

```bash
# Sau khi đã test xong
git add electron/package.json
git commit -m "chore: bump electron app version"
```

---

## Task 8: Thêm .gitignore và dọn dẹp

**Files:**
- Modify: `.gitignore`

- [ ] **Bước 1: Đảm bảo .gitignore đúng**

Kiểm tra `.gitignore` có các dòng sau:

```
# Electron
electron/dist/
electron/node_modules/
frontend/.env.electron

# Superpowers
.superpowers/
```

- [ ] **Bước 2: Xóa các file build không cần commit**

```bash
# Không commit file .exe vào git — upload lên GitHub Releases thay thế
git rm --cached electron/dist/ -r 2>/dev/null || true
```

- [ ] **Bước 3: Commit**

```bash
git add .gitignore
git commit -m "chore: cập nhật gitignore cho Electron build artifacts"
```

---

## Lưu ý sau khi hoàn thành

- **Code signing:** Nếu Windows SmartScreen block installer, cần mua code signing certificate. Hiện tại bỏ qua — user chọn "Run anyway" là được.
- **Icon thật:** Thay file `electron/build/icon.ico` bằng icon XMĐ chính thức (256x256 .ico).
- **macOS/Linux:** Không trong scope, có thể thêm sau bằng cách đổi `target` trong electron-builder config.
- **Frontend dist path:** electron-builder config dùng `../frontend/dist/**/*` — build frontend trước khi build Electron.
