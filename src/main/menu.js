// macOS application menu. Adding a real menu bar gives the app a
// pile of native shortcuts (Cmd+, for Settings, Cmd+W to close,
// Cmd+M to minimize, system Edit/Window roles) and surfaces our
// custom commands where Mac users instinctively look first.
//
// Renderer-handled commands go via webContents.send('menu:command',
// '<id>') so the menu doesn't need to know about React state — App.jsx
// listens and dispatches into its existing handlers.

const { Menu, app, shell } = require('electron');

const SUPPORT_URL = 'https://gatheros.co';

function buildAppMenu({ getMainWindow }) {
  const isMac = process.platform === 'darwin';

  const send = (id) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('menu:command', id);
  };

  // Single source of truth for menu items the renderer wants to
  // handle. accelerator is what Electron registers globally; we
  // intentionally avoid bare-key bindings here (Space, J, K, etc.)
  // because Electron menu accelerators fire even from inside <input>
  // and would steal keystrokes from the user's typing. Those single-
  // key shortcuts stay in the renderer's keydown listener.
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${app.name}` },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: () => send('open-settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Bucket',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('new-bucket'),
        },
        {
          label: 'New Board',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send('new-board'),
        },
        { type: 'separator' },
        {
          label: 'Capture Screenshot',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('capture-screenshot'),
        },
        { type: 'separator' },
        {
          label: 'Export Library…',
          click: () => send('export-library'),
        },
        {
          label: 'Snapshot Library',
          click: () => send('snapshot-library'),
        },
        ...(isMac ? [] : [
          { type: 'separator' },
          { role: 'quit' },
        ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find…',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('focus-search'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Quick Switcher',
          accelerator: 'CmdOrCtrl+K',
          click: () => send('quick-switcher'),
        },
        {
          // No accelerator — Space is bound in the renderer where it
          // can defer to <input> focus. A menu accelerator would
          // steal it from text fields.
          label: 'Quick Look',
          click: () => send('quick-look'),
        },
        {
          label: 'Rediscover',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => send('rediscover'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => send('toggle-sidebar'),
        },
        { type: 'separator' },
        ...(process.env.NODE_ENV !== 'production' ? [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
        ] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      role: 'windowMenu',
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => send('shortcuts'),
        },
        {
          label: 'What’s New',
          click: () => send('whats-new'),
        },
        { type: 'separator' },
        {
          label: 'GatherOS Website',
          click: () => shell.openExternal(SUPPORT_URL),
        },
        {
          // Surfaces ~/Library/Logs/GatherOS/main.log in Finder so
          // users can attach it to a support email after a crash.
          label: 'Reveal Logs in Finder',
          click: () => {
            const { getLogFilePath } = require('./logger');
            const p = getLogFilePath();
            if (p) shell.showItemInFolder(p);
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
