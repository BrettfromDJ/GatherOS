// Toolbar popup for GatherOS. Surfaces four actions — capture the
// visible page, capture a drag-selected region, save the page as a
// URL, and open the desktop app — plus a live connection indicator.
//
// The three save actions hand off to the service worker and close the
// popup immediately (area capture in particular needs the page free so
// the user can drag-select); results come back as system notifications
// from the worker. Status + "Open GatherOS" stay interactive here.

const HOST_NAME = 'co.gatheros.host';

const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const hint = document.getElementById('hint');

function setStatus(state, text) {
  dot.className = 'dot dot-' + state;
  statusText.textContent = text;
}

function showHint(text) {
  hint.textContent = text;
  hint.hidden = !text;
}

// Promise wrapper around sendNativeMessage that never throws — a
// missing host (app never launched) surfaces as { hostMissing: true }.
function sendNative(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST_NAME, message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, hostMissing: true, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: false });
      });
    } catch (e) {
      resolve({ ok: false, hostMissing: true, error: String((e && e.message) || e) });
    }
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isCapturable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function refreshStatus() {
  setStatus('checking', 'Checking…');
  const resp = await sendNative({ type: 'ping' });
  if (resp.hostMissing) {
    setStatus('off', 'Set up needed');
    showHint('Open GatherOS once so it can connect to this extension.');
    return;
  }
  if (resp.ok && resp.appRunning) {
    setStatus('on', 'GatherOS is open');
    showHint('');
  } else {
    setStatus('idle', 'GatherOS is closed');
    showHint('Saves will open GatherOS automatically.');
  }
}

// Wire a save action: validate the tab, fire the worker message, close.
function wireSaveAction(id, build) {
  document.getElementById(id).addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !isCapturable(tab.url)) {
      showHint("This page can't be captured — open a normal web page.");
      return;
    }
    chrome.runtime.sendMessage(build(tab));
    window.close();
  });
}

wireSaveAction('capturePage', (tab) => ({
  type: 'gatheros:capture-page',
  windowId: tab.windowId,
  tabId: tab.id,
  pageUrl: tab.url,
  pageTitle: tab.title,
}));

wireSaveAction('captureFullPage', (tab) => ({
  type: 'gatheros:capture-full-page',
  windowId: tab.windowId,
  tabId: tab.id,
  pageUrl: tab.url,
  pageTitle: tab.title,
}));

wireSaveAction('captureArea', (tab) => ({
  type: 'gatheros:capture-area',
  windowId: tab.windowId,
  tabId: tab.id,
  pageUrl: tab.url,
  pageTitle: tab.title,
}));

wireSaveAction('saveUrl', (tab) => ({
  type: 'gatheros:save-url',
  pageUrl: tab.url,
  pageTitle: tab.title,
}));

document.getElementById('openApp').addEventListener('click', async () => {
  setStatus('checking', 'Opening…');
  const resp = await sendNative({ type: 'open' });
  if (resp.hostMissing) {
    setStatus('off', 'Set up needed');
    showHint('GatherOS isn’t installed yet, or its connector hasn’t been registered.');
    return;
  }
  // Give the app a moment to boot, then reflect the new state.
  setTimeout(refreshStatus, 1400);
});

refreshStatus();
