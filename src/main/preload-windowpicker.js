const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowPicker', {
  list: () => ipcRenderer.invoke('windowpicker:list'),
  pick: (sourceId) => ipcRenderer.invoke('windowpicker:pick', sourceId),
  cancel: () => ipcRenderer.invoke('windowpicker:cancel'),
});
