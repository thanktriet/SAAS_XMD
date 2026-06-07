const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (cb) => {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateDownloaded: (cb) => {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    ipcRenderer.on('update-progress', handler);
    return () => ipcRenderer.removeListener('update-progress', handler);
  },
});
