const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('traySearch', {
  query: (text) => ipcRenderer.invoke('tray-search:query', text || ''),
  copy: (saveId) => ipcRenderer.invoke('tray-search:copy', saveId),
  reveal: (saveId) => ipcRenderer.invoke('tray-search:reveal', saveId),
  close: () => ipcRenderer.invoke('tray-search:close'),
  // Drag-out is fire-and-forget (synchronous startDrag must run off the
  // dragstart handler). The renderer's <button> sets draggable={true};
  // its onDragStart calls this and lets the OS take over.
  drag: (saveId) => ipcRenderer.send('tray-search:drag', saveId),
  // Notification from main when the popover (re)opens, so the renderer
  // can clear stale query state and re-focus the input.
  onFocus: (cb) => {
    const wrapped = () => cb();
    ipcRenderer.on('tray-search:focus', wrapped);
    return () => ipcRenderer.removeListener('tray-search:focus', wrapped);
  },
});
