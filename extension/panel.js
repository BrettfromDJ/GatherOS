// In-page GatherOS panel, injected by the service worker on toolbar
// click (chrome.scripting.executeScript). Unlike a toolbar popup, an
// injected panel is part of the page, so it can be rounded, shadowed,
// and dragged — the CSS Peeper approach. Rendered inside a shadow root
// so the host page's styles can't bleed in.
//
// Re-injecting toggles: if the panel is already open, remove it.
(() => {
  const HOST_ID = 'gatheros-panel-host';
  const VERSION = chrome.runtime.getManifest().version;

  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    // Same version → genuine toggle (user is closing the panel), so stop.
    // Different version → a stale panel left behind by a previous
    // extension load; fall through and rebuild with the current code, so
    // an extension reload shows up on the first click with no page
    // refresh. (Requires bumping the manifest version on each change.)
    if (existing.dataset.gatherosVersion === VERSION) return;
  }

  const ICONS = {
    page: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M2 8h20"/><path d="M6 4v4"/><path d="M10 4v4"/>',
    full: '<path d="M7 2h10"/><path d="M5 6h14"/><rect width="18" height="12" x="3" y="10" rx="2"/>',
    area: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  };
  const svg = (paths, w = 17) =>
    `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  // The app icon, served from the extension as a web-accessible
  // resource. Loading it via chrome-extension:// (rather than a data:
  // URI) means it isn't blocked by the host page's CSP img-src — which
  // matters on strict targets like x.com.
  const logoUrl = chrome.runtime.getURL('icons/icon.png');

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.dataset.gatherosVersion = VERSION;
  // NB: no `all:initial` here — it would reset the positioning below
  // back to static. Page-style isolation is handled by `:host` in the
  // shadow CSS, which inline styles override for position/top/right.
  host.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        --content-bg: #fafaf9;
        --surface-1: #ffffff;
        --border: rgba(0,0,0,0.07);
        --text-primary: #000;
        --text-secondary: rgba(0,0,0,0.55);
        --text-tertiary: rgba(0,0,0,0.4);
        --accent: #000;
        --accent-hover: #1f1f1f;
        --on-accent: #fff;
        --hover-bg: #eaeaea;
        --shadow-control: 0 1px 3px -1px rgba(16,16,19,0.05);
        --font: 'Geist Variable','Geist','SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif;
        width: 264px;
        padding: 12px;
        border-radius: 16px;
        background: var(--content-bg);
        box-shadow: 0 10px 34px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12);
        font-family: var(--font);
        color: var(--text-primary);
        -webkit-font-smoothing: antialiased;
        user-select: none;
      }
      @media (prefers-color-scheme: dark) {
        .panel {
          --content-bg: #1c1c1e; --surface-1: #242426; --border: rgba(255,255,255,0.09);
          --text-primary: #fff; --text-secondary: rgba(255,255,255,0.6); --text-tertiary: rgba(255,255,255,0.42);
          --accent: #fff; --accent-hover: #f0f0f0; --on-accent: #000;
          --hover-bg: rgba(255,255,255,0.08); --shadow-control: 0 1px 3px -1px rgba(0,0,0,0.4);
        }
      }
      .head { display:flex; align-items:center; gap:7px; margin:1px 2px 11px; cursor:grab; }
      .head.dragging { cursor:grabbing; }
      .logo { width:18px; height:18px; display:block; flex:none; margin-left:-1px; border-radius:4px; -webkit-user-drag:none; user-select:none; }
      .brand { font-size:13px; font-weight:600; letter-spacing:-0.012em; }
      .ver { font-size:10px; color:var(--text-tertiary); font-variant-numeric:tabular-nums; margin-left:1px; }
      .status { display:inline-flex; align-items:center; gap:6px; margin-left:auto; font-size:11px; color:var(--text-secondary); }
      .dot { width:7px; height:7px; border-radius:50%; background:#c7c7c7; flex:none; }
      .dot.on { background:#34c759; box-shadow:0 0 0 3px rgba(52,199,89,0.18); }
      .dot.idle { background:#ff9f0a; }
      .dot.off { background:#ff3b30; }
      .x { display:flex; align-items:center; justify-content:center; width:20px; height:20px; padding:0; border:none; border-radius:6px; background:transparent; color:var(--text-secondary); cursor:pointer; }
      .x:hover { background:var(--hover-bg); color:var(--text-primary); }
      .actions { display:flex; flex-direction:column; gap:6px; }
      .btn { display:flex; align-items:center; gap:10px; width:100%; padding:8px 11px; border:1px solid var(--border); border-radius:8px; background:var(--surface-1); box-shadow:var(--shadow-control); color:var(--text-primary); font-family:inherit; text-align:left; cursor:pointer; }
      .btn:hover { background:var(--hover-bg); }
      .btn:active { transform:scale(0.985); }
      .ico { display:flex; flex:none; color:var(--text-secondary); }
      .txt { display:flex; flex-direction:column; gap:1px; min-width:0; }
      .label { font-size:13px; font-weight:500; letter-spacing:-0.01em; }
      .sub { font-size:11px; color:var(--text-secondary); letter-spacing:-0.005em; }
      .open { display:flex; align-items:center; justify-content:center; gap:7px; width:100%; margin-top:8px; padding:9px 12px; border:none; border-radius:8px; background:var(--accent); color:var(--on-accent); font-family:inherit; font-size:12.5px; font-weight:550; letter-spacing:-0.01em; cursor:pointer; }
      .open .ico { color:var(--on-accent); }
      .open:hover { background:var(--accent-hover); }
      .open:active { transform:scale(0.985); }
      /* Import bookmarks: collapsed it's a normal action button; open it
         becomes a grouped card with the button as its borderless header
         and the chooser nested inside. */
      .import { margin-top:6px; }
      .import.expanded { border:1px solid var(--border); border-radius:10px; background:var(--surface-1); box-shadow:var(--shadow-control); }
      .import.expanded .btn { border:none; box-shadow:none; background:transparent; }
      .import.expanded .btn:hover { background:transparent; }
      .scope { display:flex; flex-direction:column; gap:8px; padding:0 10px 10px; }
      .scope[hidden] { display:none; }
      .chips { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
      .chip { padding:9px 6px; border:1px solid var(--border); border-radius:8px; background:var(--content-bg); color:var(--text-primary); font-family:inherit; font-size:12.5px; font-weight:500; letter-spacing:-0.01em; text-align:center; cursor:pointer; font-variant-numeric:tabular-nums; }
      .chip:hover { background:var(--hover-bg); }
      .chip:active { transform:scale(0.985); }
      .chip.selected { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
      .import-go { width:100%; padding:9px 12px; border:none; border-radius:8px; background:var(--accent); color:var(--on-accent); font-family:inherit; font-size:12.5px; font-weight:550; letter-spacing:-0.01em; cursor:pointer; }
      .import-go:disabled { opacity:0.4; cursor:default; }
      .import-go:not(:disabled):hover { background:var(--accent-hover); }
      .import-go:not(:disabled):active { transform:scale(0.985); }
      .scope-note { font-size:10.5px; color:var(--text-tertiary); letter-spacing:-0.003em; line-height:1.35; margin:0 1px; }
    </style>
    <div class="panel" part="panel">
      <div class="head" id="head">
        <img class="logo" src="${logoUrl}" alt="" draggable="false" />
        <span class="brand">GatherOS</span>
        <span class="ver" id="ver"></span>
        <span class="status"><span class="dot" id="dot"></span><span id="statusText">Checking…</span></span>
        <button class="x" id="close" title="Close">${svg(ICONS.close, 14)}</button>
      </div>
      <div class="actions">
        <button class="btn" data-action="gatheros:capture-page"><span class="ico">${svg(ICONS.page)}</span><span class="txt"><span class="label">Capture page</span><span class="sub">Visible browser area</span></span></button>
        <button class="btn" data-action="gatheros:capture-full-page"><span class="ico">${svg(ICONS.full)}</span><span class="txt"><span class="label">Capture full page</span><span class="sub">Entire scrollable page</span></span></button>
        <button class="btn" data-action="gatheros:capture-area"><span class="ico">${svg(ICONS.area)}</span><span class="txt"><span class="label">Capture area</span><span class="sub">Drag to select a region</span></span></button>
        <button class="btn" data-action="gatheros:save-url"><span class="ico">${svg(ICONS.link)}</span><span class="txt"><span class="label">Save URL</span><span class="sub">This page as a link</span></span></button>
      </div>
      <div class="import" id="import">
        <button class="btn" id="importBookmarks"><span class="ico">${svg(ICONS.bookmark)}</span><span class="txt"><span class="label">Import bookmarks</span><span class="sub" id="importSub">Backfill your X bookmarks</span></span></button>
        <div class="scope" id="scope" hidden>
          <div class="chips">
            <button class="chip" data-limit="0">All</button>
            <button class="chip" data-limit="25">25</button>
            <button class="chip" data-limit="50">50</button>
            <button class="chip" data-limit="100">100</button>
            <button class="chip" data-limit="200">200</button>
            <button class="chip" data-limit="500">500</button>
          </div>
          <button class="import-go" id="importGo" disabled>Import</button>
          <div class="scope-note">Imports your most recent bookmarks. Opens x.com and scrolls — duplicates are skipped.</div>
        </div>
      </div>
      <button class="open" id="open"><span class="ico">${svg(ICONS.open, 15)}</span><span>Open GatherOS</span></button>
    </div>
  `;

  document.documentElement.appendChild(host);

  const dot = root.getElementById('dot');
  const statusText = root.getElementById('statusText');
  // Visible build marker — if this number doesn't change after a reload,
  // you're looking at a stale panel (reload the page, or close + reopen).
  root.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  const close = () => host.remove();

  // Capture / save actions: close the panel first (so it never lands
  // in a screenshot), then fire the message. pageUrl/pageTitle come
  // from this page; the worker fills in the window/tab ids.
  root.querySelectorAll('.btn').forEach((btn) => {
    const action = btn.getAttribute('data-action');
    if (!action) return; // non-action buttons (e.g. Import) wire up below
    btn.addEventListener('click', () => {
      close();
      chrome.runtime.sendMessage({ type: action, pageUrl: location.href, pageTitle: document.title });
    });
  });

  // Import bookmarks — a two-step flow nested inside the button:
  //   1. click the button → reveal the count chooser
  //   2. pick a count (highlights, but doesn't start)
  //   3. hit Import → kick off the backfill in the background worker
  const importEl = root.getElementById('import');
  const scope = root.getElementById('scope');
  const importSub = root.getElementById('importSub');
  const importGo = root.getElementById('importGo');
  let selectedLimit = null; // 0 is a valid value (= all), so track null explicitly

  root.getElementById('importBookmarks').addEventListener('click', () => {
    scope.hidden = !scope.hidden;
    importEl.classList.toggle('expanded', !scope.hidden);
    importSub.textContent = scope.hidden
      ? 'Backfill your X bookmarks'
      : 'Choose how many, then import';
  });

  scope.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      selectedLimit = Number(chip.getAttribute('data-limit')); // 0 = all
      scope.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === chip));
      importGo.disabled = false;
    });
  });

  importGo.addEventListener('click', () => {
    if (selectedLimit === null) return; // nothing picked yet
    close();
    chrome.runtime.sendMessage({ type: 'gatheros:import-bookmarks', limit: selectedLimit });
  });

  root.getElementById('open').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'gatheros:open' }, () => {
      // Reflect the launch after a beat, if the panel's still open.
      setTimeout(refreshStatus, 1400);
    });
  });

  root.getElementById('close').addEventListener('click', close);

  const onKey = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey, true); } };
  window.addEventListener('keydown', onKey, true);

  // Drag by the header.
  const head = root.getElementById('head');
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseRight = 16;
  let baseTop = 16;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#close')) return;
    dragging = true;
    head.classList.add('dragging');
    startX = e.clientX;
    startY = e.clientY;
    const r = host.getBoundingClientRect();
    baseRight = window.innerWidth - r.right;
    baseTop = r.top;
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    host.style.right = Math.max(8, baseRight - (e.clientX - startX)) + 'px';
    host.style.top = Math.max(8, baseTop + (e.clientY - startY)) + 'px';
  });
  head.addEventListener('pointerup', (e) => {
    dragging = false;
    head.classList.remove('dragging');
    try { head.releasePointerCapture(e.pointerId); } catch {}
  });

  function refreshStatus() {
    if (!document.getElementById(HOST_ID)) return;
    setStatus('', 'Checking…');
    chrome.runtime.sendMessage({ type: 'gatheros:status' }, (resp) => {
      if (!document.getElementById(HOST_ID)) return;
      if (chrome.runtime.lastError || !resp || resp.hostMissing) { setStatus('off', 'Set up needed'); return; }
      if (resp.appRunning) setStatus('on', 'GatherOS is open');
      else setStatus('idle', 'GatherOS is closed');
    });
  }
  function setStatus(state, text) {
    dot.className = 'dot' + (state ? ' ' + state : '');
    statusText.textContent = text;
  }

  refreshStatus();
})();
