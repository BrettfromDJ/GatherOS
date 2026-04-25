// Tiny shared module so capture.js and ipc.js don't have to import the
// main BrowserWindow setup just to fire a "save:created" + toast.

let notifier = () => {};

function setSaveNotifier(fn) {
  notifier = typeof fn === 'function' ? fn : () => {};
}

function notifySaved(record) {
  notifier(record);
}

module.exports = { setSaveNotifier, notifySaved };
