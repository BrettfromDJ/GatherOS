// Service worker for the GatherOS browser extension.
//
// Single capture surface in v1: right-click any image → "Save to
// GatherOS". The SW POSTs the image URL + the page URL it was on
// to http://127.0.0.1:53247/save with the user's token in
// X-GatherOS-Token. The desktop app fetches the image itself and
// inserts a save record, identical to a drag-drop URL save.

const SERVER = 'http://127.0.0.1:53247';
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

  const { token } = await chrome.storage.local.get('token');
  if (!token) {
    notify('Open GatherOS Options and paste your token from Settings → Capture.');
    return;
  }

  try {
    const res = await fetch(`${SERVER}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GatherOS-Token': token,
      },
      body: JSON.stringify({
        imageUrl,
        pageUrl: tab?.url || info.pageUrl || null,
        pageTitle: tab?.title || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      if (res.status === 401) {
        notify('Token rejected. Re-paste the token from GatherOS Settings → Capture.');
      } else {
        notify(json.error || `Save failed (${res.status}).`);
      }
      return;
    }
    notify(json.duplicate ? 'Already in your library.' : 'Saved to GatherOS.');
  } catch (err) {
    notify('Could not reach GatherOS. Is the desktop app running?');
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
    // Notifications can fail silently on some platforms; the
    // service worker has nothing else to fall back on.
  }
}
