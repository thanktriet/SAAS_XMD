# Tauri Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo Tauri desktop wrapper cho XMĐ ERP — native Windows title bar, file .exe ~8MB, kết nối API VPS, không ảnh hưởng web browser.

**Architecture:** Tauri CLI build `tauri/src-tauri/` Rust process quản lý cửa sổ native, đọc `frontend/dist/` đã build bằng React. Vite build với `TAURI=1` để set `base: './'`. Web browser tại `http://14.225.198.127:8088` dùng `base: '/'` bình thường, không đổi gì.

**Tech Stack:** Tauri v2, Rust (stable), `tauri-plugin-window-state`, Vite + React (đã có), NSIS installer (Vietnamese), cross-env

---

## File Map

| File | Trạng thái | Mục đích |
|------|-----------|---------|
| `tauri/package.json` | Tạo mới | scripts: `tauri dev`, `tauri build` |
| `tauri/src-tauri/tauri.conf.json` | Tạo mới | App config, cửa sổ, NSIS |
| `tauri/src-tauri/Cargo.toml` | Tạo mới | Rust dependencies: tauri, tauri-plugin-window-state |
| `tauri/src-tauri/build.rs` | Tạo mới | Boilerplate build script |
| `tauri/src-tauri/src/main.rs` | Tạo mới | Rust main process (minimal) |
| `tauri/src-tauri/icons/icon.ico` | Copy từ electron | Icon 256x256 |
| `tauri/src-tauri/icons/icon.png` | Tạo mới | Icon PNG 256x256 (required by Tauri) |
| `frontend/package.json` | Sửa | Thêm script `build:tauri` |
| `frontend/vite.config.ts` | Sửa | `base` check thêm `TAURI=1` |

---

## Task 1: Cập nhật frontend/vite.config.ts và frontend/package.json

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Sửa vite.config.ts — thêm TAURI env check**

Mở `frontend/vite.config.ts`. Dòng hiện tại:
```ts
base: process.env.ELECTRON === '1' ? './' : '/',
```
Đổi thành:
```ts
base: (process.env.ELECTRON === '1' || process.env.TAURI === '1') ? './' : '/',
```

- [ ] **Step 2: Thêm script build:tauri vào frontend/package.json**

Trong `frontend/package.json`, thêm vào `"scripts"`:
```json
"build:tauri": "cross-env TAURI=1 VITE_API_BASE_URL=http://14.225.198.127:8088/api tsc -b && cross-env TAURI=1 VITE_API_BASE_URL=http://14.225.198.127:8088/api vite build"
```

`cross-env` đã có trong devDependencies từ trước (dùng cho Electron), không cần cài thêm.

- [ ] **Step 3: Verify build:tauri chạy được**

```powershell
cd D:\XMD_SAAS\frontend
npm run build:tauri
```

Expected output: `dist/index.html` tồn tại và `dist/assets/` có các JS chunks. Nếu lỗi TypeScript thì fix trước khi tiếp tục.

- [ ] **Step 4: Kiểm tra BASE_URL trong dist**

```powershell
Select-String -Path D:\XMD_SAAS\frontend\dist\index.html -Pattern 'src='
```

Expected: Các path là `./assets/...` (có dấu `./`), không phải `/assets/...`.

- [ ] **Step 5: Commit**

```powershell
git add frontend/vite.config.ts frontend/package.json
git commit -m "feat: add TAURI env support in vite build config"
```

---

## Task 2: Tạo cấu trúc thư mục tauri/ và package.json

**Files:**
- Create: `tauri/package.json`
- Create: `tauri/src-tauri/` (directory)

- [ ] **Step 1: Kiểm tra Tauri CLI và Rust**

```powershell
cargo --version
rustc --version
```

Expected: cargo 1.x, rustc 1.x. Nếu chưa có, cài tại https://rustup.rs.

```powershell
npm list -g @tauri-apps/cli
```

Nếu chưa có:
```powershell
npm install -g @tauri-apps/cli@^2
```

- [ ] **Step 2: Tạo tauri/package.json**

Tạo file `D:\XMD_SAAS\tauri\package.json`:
```json
{
  "name": "xmd-erp-tauri",
  "version": "1.0.0",
  "description": "XMĐ ERP Desktop (Tauri)",
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

- [ ] **Step 3: Cài devDependencies**

```powershell
cd D:\XMD_SAAS\tauri
npm install
```

Expected: `node_modules/@tauri-apps/cli/` tồn tại.

- [ ] **Step 4: Tạo thư mục src-tauri/src/**

```powershell
New-Item -ItemType Directory -Force D:\XMD_SAAS\tauri\src-tauri\src
New-Item -ItemType Directory -Force D:\XMD_SAAS\tauri\src-tauri\icons
```

- [ ] **Step 5: Commit**

```powershell
git add tauri/package.json tauri/package-lock.json
git commit -m "feat: scaffold tauri/ package.json"
```

---

## Task 3: Tạo Rust source files (main.rs, build.rs, Cargo.toml)

**Files:**
- Create: `tauri/src-tauri/src/main.rs`
- Create: `tauri/src-tauri/build.rs`
- Create: `tauri/src-tauri/Cargo.toml`

- [ ] **Step 1: Tạo tauri/src-tauri/Cargo.toml**

```toml
[package]
name = "xmd-erp"
version = "1.0.0"
edition = "2021"

[lib]
name = "xmd_erp_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[[bin]]
name = "xmd-erp"
path = "src/main.rs"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-window-state = "2"

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

- [ ] **Step 2: Tạo tauri/src-tauri/build.rs**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Tạo tauri/src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_window_state::Builder as WindowStateBuilder;

fn main() {
    tauri::Builder::default()
        .plugin(WindowStateBuilder::default().build())
        .run(tauri::generate_context!())
        .expect("Lỗi khi khởi động XMĐ ERP");
}
```

- [ ] **Step 4: Verify Cargo.toml parse được**

```powershell
cd D:\XMD_SAAS\tauri\src-tauri
cargo check 2>&1 | Select-Object -First 20
```

Expected: lỗi `tauri.conf.json not found` (vì chưa có file này) hoặc lỗi crate download — đây là bình thường, chưa cần pass hoàn toàn.

- [ ] **Step 5: Commit**

```powershell
cd D:\XMD_SAAS
git add tauri/src-tauri/src/main.rs tauri/src-tauri/build.rs tauri/src-tauri/Cargo.toml
git commit -m "feat: add tauri rust main process with window-state plugin"
```

---

## Task 4: Tạo tauri.conf.json

**Files:**
- Create: `tauri/src-tauri/tauri.conf.json`

- [ ] **Step 1: Tạo tauri/src-tauri/tauri.conf.json**

```json
{
  "productName": "XMĐ ERP",
  "version": "1.0.0",
  "identifier": "com.xmd.erp",
  "build": {
    "beforeBuildCommand": "cd ../frontend && npm run build:tauri",
    "frontendDist": "../frontend/dist"
  },
  "app": {
    "windows": [
      {
        "title": "XMĐ ERP",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
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

**Lưu ý:** `beforeBuildCommand` dùng `cd ../frontend && npm run build:tauri` — đây là shell command, trên Windows phải là `cd ..\frontend && npm run build:tauri` hoặc dùng PowerShell. Tauri v2 tự detect shell. Nếu lỗi, thay bằng:
```json
"beforeBuildCommand": "npm run build:tauri --prefix ../frontend"
```

- [ ] **Step 2: Verify JSON parse được**

```powershell
Get-Content D:\XMD_SAAS\tauri\src-tauri\tauri.conf.json | ConvertFrom-Json | Select productName, version, identifier
```

Expected: `productName = "XMĐ ERP"`, `version = "1.0.0"`.

- [ ] **Step 3: Commit**

```powershell
git add tauri/src-tauri/tauri.conf.json
git commit -m "feat: add tauri.conf.json with NSIS Vietnamese and window config"
```

---

## Task 5: Chuẩn bị icons

**Files:**
- Create: `tauri/src-tauri/icons/icon.ico`
- Create: `tauri/src-tauri/icons/icon.png`

- [ ] **Step 1: Copy icon.ico từ Electron**

```powershell
Copy-Item D:\XMD_SAAS\electron\build\icon.ico D:\XMD_SAAS\tauri\src-tauri\icons\icon.ico
```

- [ ] **Step 2: Tạo icon.png 256x256 từ icon.ico**

Tauri cần file `.png`. Dùng .NET Drawing:

```powershell
Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon("D:\XMD_SAAS\tauri\src-tauri\icons\icon.ico")
$bitmap = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.DrawImage($ico.ToBitmap(), 0, 0, 256, 256)
$g.Dispose()
$bitmap.Save("D:\XMD_SAAS\tauri\src-tauri\icons\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Host "icon.png created"
```

- [ ] **Step 3: Verify icons tồn tại**

```powershell
Get-Item D:\XMD_SAAS\tauri\src-tauri\icons\icon.ico | Select Length
Get-Item D:\XMD_SAAS\tauri\src-tauri\icons\icon.png | Select Length
```

Expected: cả hai file > 0 bytes.

- [ ] **Step 4: Commit**

```powershell
git add tauri/src-tauri/icons/
git commit -m "feat: add tauri app icons"
```

---

## Task 6: Build Tauri production installer

**Files:**
- No new files — build output tại `tauri/src-tauri/target/release/bundle/nsis/`

- [ ] **Step 1: Build frontend trước để test**

```powershell
cd D:\XMD_SAAS\frontend
npm run build:tauri
```

Expected: `dist/index.html` tồn tại, path dùng `./assets/`.

- [ ] **Step 2: Chạy tauri build**

```powershell
cd D:\XMD_SAAS\tauri
npx tauri build
```

Lần đầu sẽ download Rust crates (~5-15 phút). Expected output cuối: 
```
    Finished release [optimized] target(s)
    Bundling XMĐ ERP_1.0.0_x64-setup.exe
```

- [ ] **Step 3: Verify installer tồn tại**

```powershell
Get-Item "D:\XMD_SAAS\tauri\src-tauri\target\release\bundle\nsis\*.exe" | Select Name, Length
```

Expected: file `XMĐ ERP_1.0.0_x64-setup.exe`, khoảng 5-15MB.

- [ ] **Step 4: Test cài đặt**

Chạy installer, kiểm tra:
- Setup wizard hiển thị tiếng Việt
- Cài xong có shortcut trên Desktop
- Mở app lên, thấy cửa sổ native Windows title bar màu trắng
- App load được trang Login

- [ ] **Step 5: Verify web browser không bị ảnh hưởng**

Mở `http://14.225.198.127:8088` trên browser. Expected: app web chạy bình thường, không có gì thay đổi.

- [ ] **Step 6: Commit**

```powershell
cd D:\XMD_SAAS
git add tauri/src-tauri/Cargo.lock
git commit -m "feat: tauri desktop app - production build ready"
```

---

## Xử lý lỗi thường gặp

### Lỗi `beforeBuildCommand` trên Windows

Nếu lỗi `npm run build:tauri --prefix ../frontend` không chạy được, thử:
```json
"beforeBuildCommand": "powershell -Command \"cd ../frontend; npm run build:tauri\""
```
Hoặc build frontend thủ công trước khi `tauri build`.

### Lỗi WebView2 không tìm thấy

Tauri dùng WebView2 (đã có sẵn trên Windows 10/11 update mới). Nếu máy chưa có:
```
winget install Microsoft.EdgeWebView2Runtime
```

### Lỗi Rust crate `tauri-plugin-window-state` version

Kiểm tra version mới nhất:
```powershell
cargo search tauri-plugin-window-state 2>&1 | Select-Object -First 3
```

Nếu cần, update Cargo.toml dùng version cụ thể: `tauri-plugin-window-state = "2.0.0"`.

### Lỗi NSIS Vietnamese không nhận

Tauri v2 dùng tên `"Vietnamese"` (không phải language code). Nếu lỗi, bỏ dòng `languages` để dùng English mặc định.

---

## Checklist cuối

- [ ] `frontend/vite.config.ts` check cả `ELECTRON` và `TAURI`
- [ ] `frontend/package.json` có script `build:tauri`  
- [ ] `tauri/src-tauri/tauri.conf.json` config đúng (productName, frontendDist, nsis Vietnamese)
- [ ] `tauri/src-tauri/src/main.rs` dùng `tauri-plugin-window-state`
- [ ] Icons tồn tại: `icon.ico` + `icon.png` trong `tauri/src-tauri/icons/`
- [ ] Build thành công → file `.exe` khoảng 5-15MB
- [ ] App cài được, title bar native màu trắng Windows
- [ ] Web browser `http://14.225.198.127:8088` vẫn chạy bình thường
