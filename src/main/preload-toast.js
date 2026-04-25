const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toast', {
  onShow: (listener) => {
    const wrapped = (_e, record) => listener(record);
    ipcRenderer.on('toast:show', wrapped);
    return () => ipcRenderer.removeListener('toast:show', wrapped);
  },
  setInteractive: (interactive) => ipcRenderer.send('toast:set-interactive', !!interactive),
  empty: () => ipcRenderer.send('toast:empty'),
  openImage: (filePath) => ipcRenderer.invoke('image:open-in-preview', filePath),
});
