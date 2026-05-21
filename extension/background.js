// Service worker for the GatherOS browser extension.
//
// v1 capture surface: right-click any image → "Save to GatherOS".
// Talks to the desktop app via Chrome's native messaging protocol —
// no localhost port, no token paste, no Options page. The desktop
// app installs the native host manifest on first launch, so
// installing the extension and the app in either order works.

const HOST_NAME = 'co.gatheros.host';
const MENU_ID = 'gatheros-save-image';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Save to GatherOS',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    notify('No image URL on that element.');
    return;
  }

  try {
    const response = await chrome.runtime.sendNativeMessage(HOST_NAME, {
      type: 'save',
      imageUrl,
      pageUrl: tab?.url || info.pageUrl || null,
      pageTitle: tab?.title || null,
    });
    if (!response || !response.ok) {
      // Most common failure modes from the host:
      //   - app not running  → "app not running"
      //   - 401             → "invalid token" (prefs.json missing token)
      //   - 400             → "imageUrl required"
      const msg = response?.error || 'Save failed.';
      if (msg === 'app not running' || msg === 'GatherOS is not installed or has never been launched.') {
        notify('Open GatherOS first, then try again.');
      } else {
        notify(msg);
      }
      return;
    }
    notify(response.duplicate ? 'Already in your library.' : 'Saved to GatherOS.');
  } catch (err) {
    // chrome.runtime.lastError surfaces here as the rejection.
    // Most common: host not found (manifest never installed),
    // which means the desktop app hasn't been launched yet.
    const msg = err?.message || String(err);
    if (msg.includes('host not found') || msg.includes('Specified native messaging host')) {
      notify('Open GatherOS once to finish setup, then try again.');
    } else {
      notify(`Couldn't reach GatherOS — ${msg}`);
    }
  }
});

function notify(message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon.png',
      title: 'GatherOS',
      message,
    });
  } catch {
    // Notifications can fail silently on some platforms; nothing
    // else to fall back on from a service worker.
  }
}
