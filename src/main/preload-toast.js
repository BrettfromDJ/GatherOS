const { contextBridge, ipcRenderer } = require('electron');

let listener = null;
const buffer = [];

ipcRenderer.on('toast:show', (_e, record) => {
  if (listener) listener(record);
  else buffer.push(record);
});

contextBridge.exposeInMainWorld('toast', {
  onShow: (fn) => {
    listener = fn;
    while (buffer.length) fn(buffer.shift());
    return () => { listener = null; };
  },
  setInteractive: (interactive) => ipcRenderer.send('toast:set-interactive', !!interactive),
  empty: () => ipcRenderer.send('toast:empty'),
  // Opens the just-saved asset inside Gather's focused view (not the OS
  // Preview app).
  openInApp: (saveId) => ipcRenderer.invoke('toast:open-save', saveId),
  // Soft-delete the just-saved records (back to Trash) when the user
  // hits Undo on the save toast.
  undo: (ids) => ipcRenderer.invoke('toast:undo-saves', ids),
});
