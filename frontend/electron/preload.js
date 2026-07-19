const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge: the React app calls window.desktop.* — no direct Node access.
contextBridge.exposeInMainWorld('desktop', {
  print: () => ipcRenderer.invoke('print'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  isDesktop: true,
});
