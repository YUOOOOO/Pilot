const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pilotDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('pilot:info'),
  retry: () => ipcRenderer.invoke('pilot:retry'),
  openLogs: () => ipcRenderer.invoke('pilot:logs'),
  selectDirectory: () => ipcRenderer.invoke('pilot:select-directory'),
  checkForUpdates: () => ipcRenderer.invoke('pilot:updates'),
}));

window.addEventListener('DOMContentLoaded', () => {
  // The startup splash owns its own layout; window chrome belongs to the app surface only.
  if (location.protocol === 'file:') return;
  const style = document.createElement('style');
  // 不再有单独的 preload 窗口标题栏：会话头部本身贴在窗口顶部充当标题栏，
  // 最小化/最大化/关闭由 Electron 的原生 overlay 画在右上角；窗口拖拽区移到侧栏顶部。
  style.textContent = `
    html { --pilot-titlebar-height:0px; --dsh-frame-chrome-top:0px; --dsh-frame-overlay-top:20px; }
    body { overflow:hidden; }
    body > #root { height:100dvh; }
  `;
  document.head.appendChild(style);
});
