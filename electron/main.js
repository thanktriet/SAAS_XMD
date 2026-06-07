const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store();

let mainWindow = null;
let splashWindow = null;
let tray = null;

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
      <div style="font-size:48px;font-weight:bold;margin-bottom:8px">XM%C4%90</div>
      <div style="font-size:16px;opacity:0.8;margin-bottom:32px">H%E1%BB%87 Th%E1%BB%91ng Qu%E1%BA%A3n L%C3%BD ERP</div>
      <div style="width:200px;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;">
        <div id="bar" style="width:0%;height:100%;background:white;border-radius:2px;transition:width 0.3s"></div>
      </div>
      <div style="margin-top:12px;font-size:12px;opacity:0.6">%C4%90ang kh%E1%BB%9Fi %C4%91%E1%BB%99ng...</div>
      <script>
        let p = 0;
        const bar = document.getElementById('bar');
        const t = setInterval(() => { p = Math.min(p + Math.random() * 15, 85); bar.style.width = p + '%'; if (p >= 85) clearInterval(t); }, 200);
      </script>
    </body>
    </html>
  `);
}

function getDistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend', 'dist', 'index.html');
  }
  return path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
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

  mainWindow.loadFile(getDistPath());

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
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('XMĐ ERP');

  const menu = Menu.buildFromTemplate([
    { label: 'Mở XMĐ ERP', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Thoát', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } });
}

function checkForUpdates() {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
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
