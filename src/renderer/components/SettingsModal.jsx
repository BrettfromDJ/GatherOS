import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  History, User, Sparkles, Hash, Database, Info, Trash2, SquareLibrary as Library, Pencil, Plus, RefreshCw, MoreHorizontal,
  Palette as PaletteIcon,
  Camera as CameraIcon,
  Download as DownloadIcon,
  Monitor as MonitorIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  Crop as CropIcon,
  AppWindow as AppWindowIcon,
  Maximize as MaximizeIcon,
  LogOut as LogOutIcon,
  CreditCard as CreditCardIcon,
  FileArchive as FileArchiveIcon,
  Eraser as EraserIcon,
} from 'lucide-react';
import styles from './SettingsModal.module.css';
import { confirm } from '../lib/confirm.js';
import AcknowledgmentsModal from './AcknowledgmentsModal.jsx';
import PrivacyModal from './PrivacyModal.jsx';

const SUPPORT_EMAIL = 'hello@designjoy.co';

// Settings is laid out as a two-pane modal: a left rail of category
// nav entries and a main content area showing one page at a time.
// Adding a new category = append an entry here and a render branch
// in the content switch below — beats the old drawer accordion as
// the surface area grows.
const NAV_ITEMS = [
  { id: 'account',    label: 'Account',    Icon: User },
  { id: 'appearance', label: 'Appearance', Icon: PaletteIcon },
  { id: 'libraries',  label: 'Libraries',  Icon: Library },
  { id: 'ai',         label: 'AI Usage',   Icon: Sparkles },
  { id: 'tags',       label: 'Tags',       Icon: Hash },
  { id: 'capture',    label: 'Capture',    Icon: CameraIcon },
  { id: 'updates',    label: 'Updates',    Icon: DownloadIcon },
  { id: 'data',       label: 'Data',       Icon: Database },
  { id: 'about',      label: 'About',      Icon: Info },
];

function formatPlanLabel(account) {
  if (!account) return '—';
  const sub = account.subscription;
  if (sub) {
    const plan = sub.plan === 'yearly' ? 'Yearly' : sub.plan === 'monthly' ? 'Monthly' : '';
    const status = sub.status;
    if (status === 'trialing') return plan ? `${plan} · Trial` : 'Trial';
    if (status === 'past_due') return plan ? `${plan} · Past due` : 'Past due';
    if (status === 'canceled') return plan ? `${plan} · Canceled` : 'Canceled';
    if (status === 'paused') return plan ? `${plan} · Paused` : 'Paused';
    return plan || 'Active';
  }
  if (account.reason === 'trial') return 'Trial';
  return 'Free';
}

function formatPeriodEnd(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// Usage meter for the AI page. Shows the current monthly token total
// against the soft cap as a thin bar — the bar tints amber as the
// user nears the cap and red once they're over it. We're "fail-open":
// requests still go through even past the cap, but the visual cue
// nudges power users toward an upgrade path.
function UsageMeter({ usage }) {
  const total = usage?.total_tokens || 0;
  const cap = usage?.soft_cap || 0;
  const overCap = !!usage?.over_cap;
  const ratio = cap > 0 ? Math.min(1, total / cap) : 0;
  const requests = usage?.request_count || 0;
  const fillClass = overCap
    ? styles.usageMeterFillOver
    : ratio > 0.8
      ? styles.usageMeterFillWarn
      : '';

  // Image generation lives on its own cost axis (per-image, not
  // per-token), so it gets its own meter rather than being lumped
  // into the token total.
  const imageCount = usage?.image_count || 0;
  const imageCap = usage?.image_soft_cap || 0;
  const imageOverCap = !!usage?.image_over_cap;
  const imageRatio = imageCap > 0 ? Math.min(1, imageCount / imageCap) : 0;
  const imageFillClass = imageOverCap
    ? styles.usageMeterFillOver
    : imageRatio > 0.8
      ? styles.usageMeterFillWarn
      : '';

  return (
    <div className={styles.usageMeter}>
      <div className={styles.usageMeterRow}>
        <span>This month · {requests} {requests === 1 ? 'request' : 'requests'}</span>
        <span className={styles.usageMeterTokens}>
          {formatTokens(total)} / {formatTokens(cap)} tokens
        </span>
      </div>
      <div className={styles.usageMeterTrack}>
        <div
          className={`${styles.usageMeterFill} ${fillClass}`}
          style={{ width: `${Math.max(2, ratio * 100)}%` }}
        />
      </div>
      {imageCap > 0 && (
        <>
          <div className={`${styles.usageMeterRow} ${styles.usageMeterRowSpaced}`}>
            <span>Image generations</span>
            <span className={styles.usageMeterTokens}>
              {imageCount} / {imageCap} this month
            </span>
          </div>
          <div className={styles.usageMeterTrack}>
            <div
              className={`${styles.usageMeterFill} ${imageFillClass}`}
              style={{ width: `${Math.max(2, imageRatio * 100)}%` }}
            />
          </div>
        </>
      )}
      {(overCap || imageOverCap) && (
        <div className={styles.usageMeterOverNote}>
          Monthly limit reached. New requests will be blocked until the
          start of next month.
        </div>
      )}
    </div>
  );
}

// Libraries settings page — replaces the inline rename/delete
// affordances that used to live next to the LibrarySwitcher trigger.
// Renders one row per library: name (rename inline), Switch button
// when not active, Delete button (gated when only one exists).
function LibrariesPage({
  libraries = [],
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}) {
  const [renamingId, setRenamingId] = React.useState(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [creatingDraft, setCreatingDraft] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [openMenuId, setOpenMenuId] = React.useState(null);

  // Close the row menu when clicking anywhere outside it or pressing Esc.
  React.useEffect(() => {
    if (!openMenuId) return undefined;
    const onDocDown = (e) => {
      if (e.target.closest?.(`.${styles.libraryRowMenu}`)) return;
      if (e.target.closest?.(`.${styles.libraryRowMenuTrigger}`)) return;
      setOpenMenuId(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenMenuId(null); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  function startRename(lib) {
    setRenamingId(lib.id);
    setRenameDraft(lib.name);
  }

  async function commitRename() {
    const next = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    setRenameDraft('');
    if (!id || !next) return;
    const orig = libraries.find((l) => l.id === id);
    if (!orig || orig.name === next) return;
    await onRename?.(id, next);
  }

  async function commitCreate() {
    const next = creatingDraft.trim();
    setCreating(false);
    setCreatingDraft('');
    if (!next) return;
    await onCreate?.(next);
  }

  return (
    <>
      <div className={styles.libraryList}>
        {libraries.map((lib) => {
          const isActive = lib.id === activeId;
          const isRenaming = renamingId === lib.id;
          return (
            <div
              key={lib.id}
              className={`${styles.libraryRow} ${isActive ? styles.libraryRowActive : ''}`}
            >
              <span className={styles.libraryRowGlyph} aria-hidden="true">
                <Library size={16} strokeWidth={1.6} />
              </span>
              <div className={styles.libraryRowMain}>
                {isRenaming ? (
                  <input
                    autoFocus
                    className={styles.libraryRenameInput}
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenameDraft('');
                      }
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <span className={styles.libraryRowName}>
                    {lib.name}
                    {isActive && (
                      <span className={styles.libraryRowActiveTag}>Active</span>
                    )}
                  </span>
                )}
                <span className={styles.libraryRowMeta}>
                  {lib.save_count != null ? `${lib.save_count} saves` : ''}
                </span>
              </div>
              <div className={styles.libraryRowActions}>
                {!isRenaming && (
                  <div className={styles.libraryRowMenuWrap}>
                    <button
                      type="button"
                      className={styles.libraryRowMenuTrigger}
                      onClick={() =>
                        setOpenMenuId((id) => (id === lib.id ? null : lib.id))
                      }
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === lib.id}
                      aria-label={`Actions for ${lib.name}`}
                    >
                      <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    {openMenuId === lib.id && (
                      <div className={styles.libraryRowMenu} role="menu">
                        {!isActive && (
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.libraryRowMenuItem}
                            onClick={() => {
                              setOpenMenuId(null);
                              onSwitch?.(lib.id);
                            }}
                          >
                            <RefreshCw size={14} strokeWidth={1.7} aria-hidden="true" />
                            Switch
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.libraryRowMenuItem}
                          onClick={() => {
                            setOpenMenuId(null);
                            startRename(lib);
                          }}
                        >
                          <Pencil size={14} strokeWidth={1.7} aria-hidden="true" />
                          Rename
                        </button>
                        {libraries.length > 1 && (
                          <button
                            type="button"
                            role="menuitem"
                            className={`${styles.libraryRowMenuItem} ${styles.libraryRowMenuItemDanger}`}
                            onClick={async () => {
                              setOpenMenuId(null);
                              const ok = await confirm({
                                title: `Delete "${lib.name}"?`,
                                message: "This permanently removes the library and all of its saves. This can't be undone.",
                                confirmLabel: 'Delete',
                                destructive: true,
                              });
                              if (ok) onDelete?.(lib.id);
                            }}
                          >
                            <Trash2 size={14} strokeWidth={1.7} aria-hidden="true" />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {creating ? (
          <div className={styles.libraryCreateRow}>
            <div className={styles.libraryRow}>
              <span className={styles.libraryRowGlyph} aria-hidden="true">
                <Library size={16} strokeWidth={1.6} />
              </span>
              <div className={styles.libraryRowMain}>
                <input
                  autoFocus
                  className={styles.libraryRenameInput}
                  placeholder="New library name"
                  value={creatingDraft}
                  onChange={(e) => setCreatingDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitCreate();
                    } else if (e.key === 'Escape') {
                      setCreating(false);
                      setCreatingDraft('');
                    }
                  }}
                />
              </div>
            </div>
            <div className={styles.libraryCreateActions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  setCreating(false);
                  setCreatingDraft('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={commitCreate}
                disabled={!creatingDraft.trim()}
              >
                Create
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.libraryAddBtn}`}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} strokeWidth={1.7} aria-hidden="true" />
            New library
          </button>
        )}
      </div>
    </>
  );
}

function DrawerChevron() {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+S';

// Accelerator capture input — focus it, press a key combo, and the
// resulting Electron-style "CommandOrControl+Shift+S" string is
// stored. Esc cancels; clearing falls back to the default.
//
// Display side renders each token as a separate keycap so the combo
// reads at a glance (⌘ ⇧ S) instead of as a debug string.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');

function acceleratorToKeys(value) {
  if (!value) return [];
  return value.split('+').map((tok) => {
    const t = tok.trim();
    switch (t) {
      case 'CommandOrControl':
      case 'CmdOrCtrl':
        return IS_MAC ? '⌘' : 'Ctrl';
      case 'Command':
      case 'Cmd':
      case 'Meta':
      case 'Super':
        return '⌘';
      case 'Control':
      case 'Ctrl':
        return IS_MAC ? '⌃' : 'Ctrl';
      case 'Shift':
        return '⇧';
      case 'Alt':
      case 'Option':
        return IS_MAC ? '⌥' : 'Alt';
      case 'Space':
        return 'Space';
      case 'Enter':
      case 'Return':
        return '⏎';
      case 'Backspace':
        return '⌫';
      case 'Delete':
        return '⌦';
      case 'Tab':
        return '⇥';
      case 'Escape':
      case 'Esc':
        return 'Esc';
      case 'Up':    return '↑';
      case 'Down':  return '↓';
      case 'Left':  return '←';
      case 'Right': return '→';
      default:
        return t.length === 1 ? t.toUpperCase() : t;
    }
  });
}

function ShortcutCapture({ value, defaultValue, onChange }) {
  const [capturing, setCapturing] = useState(false);

  function format(e) {
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null;
    parts.push(key);
    return parts.join('+');
  }

  function handleKeyDown(e) {
    if (!capturing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setCapturing(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const combo = format(e);
    if (combo) {
      onChange?.(combo);
      setCapturing(false);
    }
  }

  const keys = acceleratorToKeys(value);
  const canReset = !!defaultValue && value !== defaultValue;

  return (
    <div className={styles.shortcutCapture}>
      <button
        type="button"
        className={`${styles.shortcutCaptureBtn} ${capturing ? styles.shortcutCaptureBtnActive : ''}`}
        onClick={() => setCapturing((v) => !v)}
        onKeyDown={handleKeyDown}
      >
        {capturing ? (
          <span className={styles.shortcutCapturePrompt}>Press a key combo…</span>
        ) : keys.length > 0 ? (
          <span className={styles.shortcutKeys}>
            {keys.map((k, i) => (
              <kbd key={i} className={styles.shortcutKey}>{k}</kbd>
            ))}
          </span>
        ) : (
          <span className={styles.shortcutCapturePrompt}>Set a shortcut</span>
        )}
      </button>
      {canReset && (
        <button
          type="button"
          className={styles.shortcutResetBtn}
          onClick={() => onChange?.(defaultValue)}
          title="Reset to default"
        >
          Reset
        </button>
      )}
    </div>
  );
}

// Folder picker — shows the selected path (truncated mid-string) and
// a button that opens the native folder picker via the dialog IPC.
function FolderPickerRow({ value, onChange }) {
  const display = value
    ? value.replace(/^.*\/(.{0,40})$/, (m, tail) => (m.length > 50 ? `…/${tail}` : m))
    : 'No folder selected';
  async function pick() {
    const result = await window.moodmark.settings.pickFolder?.();
    if (result?.path) onChange?.(result.path);
  }
  return (
    <div className={styles.folderPicker}>
      <span className={styles.folderPickerPath} title={value || ''}>
        {display}
      </span>
      <button type="button" className={styles.folderPickerBtn} onClick={pick}>
        Choose location
      </button>
      {value && (
        <button
          type="button"
          className={styles.folderPickerBtn}
          onClick={() => onChange?.(null)}
        >
          Clear
        </button>
      )}
    </div>
  );
}

// Updates page — auto-update toggle, manual check button, beta opt-in.
// Talks to the existing electron-updater pipeline via new IPCs added
// alongside this commit.
function UpdatesPage({ prefs, updatePref }) {
  const [state, setState] = useState({ checking: false, status: null, version: null });

  useEffect(() => {
    if (!window.moodmark?.on) return undefined;
    const off1 = window.moodmark.on('update-ready', (info) => {
      setState({ checking: false, status: 'ready', version: info?.version || null });
    });
    const off2 = window.moodmark.on('update-error', (info) => {
      setState({ checking: false, status: 'error', message: info?.message });
    });
    return () => {
      off1?.();
      off2?.();
    };
  }, []);

  async function handleCheck() {
    setState({ checking: true, status: null });
    const result = await window.moodmark.updater.check?.();
    if (!result) {
      setState({ checking: false, status: 'unsupported' });
      return;
    }
    if (result.upToDate) {
      setState({ checking: false, status: 'up-to-date' });
    } else if (result.error) {
      setState({ checking: false, status: 'error', message: result.error });
    } else {
      setState({ checking: false, status: 'downloading' });
    }
  }

  async function handleInstall() {
    await window.moodmark.updater.install();
  }

  return (
    <div className={styles.page}>
      <p className={styles.sectionHint}>
        GatherOS checks for updates in the background and installs
        them the next time you quit.
      </p>

      <div className={styles.toggleRow}>
        <span className={styles.toggleLabel}>Download updates automatically</span>
        <ToggleSwitch
          on={prefs.updatesAuto !== false}
          onChange={(v) => updatePref('updatesAuto', v)}
        />
      </div>

      <div className={`${styles.actions} ${styles.actionsStart}`} style={{ marginTop: 20 }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleCheck}
          disabled={state.checking}
        >
          <DownloadIcon size={14} strokeWidth={1.7} aria-hidden="true" />
          {state.checking ? 'Checking…' : 'Check for updates'}
        </button>
        {state.status === 'ready' && (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleInstall}>
            Restart and install{state.version ? ` v${state.version}` : ''}
          </button>
        )}
      </div>

      {(() => {
        let text = null;
        if (state.checking) text = 'Checking for updates…';
        else if (state.status === 'up-to-date') text = "You're on the latest version.";
        else if (state.status === 'downloading') text = 'Downloading update in the background…';
        else if (state.status === 'ready') text = `Update ready to install${state.version ? ` (v${state.version})` : ''}.`;
        else if (state.status === 'error') text = `Update failed: ${state.message || 'unknown'}`;
        else if (state.status === 'unsupported') text = "Updates aren't available in this build (dev mode).";
        if (!text) return null;
        return (
          <p className={styles.sectionHint} style={{ marginTop: 16 }}>
            {text}
          </p>
        );
      })()}
    </div>
  );
}

// Tiny on/off toggle pill — used for boolean prefs.
function ToggleSwitch({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`${styles.toggleSwitch} ${on ? styles.toggleSwitchOn : ''}`}
      onClick={() => onChange?.(!on)}
    >
      <span className={styles.toggleSwitchThumb} aria-hidden="true" />
    </button>
  );
}

export default function SettingsModal({
  open,
  drawerHint,
  onClose,
  onConfiguredChange,
  onPrefsChange,
  onLibraryWiped,
  libraries = [],
  activeLibraryId = null,
  onSwitchLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
}) {
  // Whether the licensing session is present — proxy-mode AI is
  // gated on it, not on a per-user OpenAI key. AppGate already shows
  // the signin screen when this is false, so for the most part this
  // flag stays true throughout Settings.
  const [hasAi, setHasAi] = useState(false);
  const [usage, setUsage] = useState(null);
  const [prefs, setPrefs] = useState({ autoNameOnSave: true, theme: 'light' });
  const [unindexed, setUnindexed] = useState(0);
  const [reindexState, setReindexState] = useState({ running: false, processed: 0, total: 0 });
  const [exportState, setExportState] = useState({ running: false, message: null });
  const [wipeState, setWipeState] = useState({ running: false, message: null });
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotState, setSnapshotState] = useState({ running: false, message: null });
  const [snapshotsListOpen, setSnapshotsListOpen] = useState(false);
  const [activePage, setActivePage] = useState('account');
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState({ id: null, name: '' });
  const [tagBusy, setTagBusy] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  // 'count_desc' | 'name_asc' | 'unused_first'
  const [tagSort, setTagSort] = useState('count_desc');
  const [tagShowAll, setTagShowAll] = useState(false);
  const [acksOpen, setAcksOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [portalState, setPortalState] = useState({ running: false, message: null });
  const appVersion = window.moodmark?.app?.version || '';

  async function handleWipeLibrary() {
    if (wipeState.running) return;
    setWipeState({ running: true, message: null });
    try {
      const result = await window.moodmark.library.wipeAll();
      if (result?.ok) {
        setWipeState({ running: false, message: `Erased ${result.removed} saves` });
        onLibraryWiped?.();
      } else if (result?.canceled) {
        setWipeState({ running: false, message: null });
      } else {
        setWipeState({ running: false, message: result?.error || 'Wipe failed' });
      }
    } catch (err) {
      setWipeState({ running: false, message: err.message || 'Wipe failed' });
    }
  }

  async function handleExportLibrary() {
    if (exportState.running) return;
    setExportState({ running: true, message: null });
    try {
      const result = await window.moodmark.library.exportZip();
      if (result?.ok) {
        setExportState({ running: false, message: `Exported to ${result.savedPath}` });
      } else if (result?.canceled) {
        setExportState({ running: false, message: null });
      } else {
        setExportState({ running: false, message: result?.error || 'Export failed' });
      }
    } catch (err) {
      setExportState({ running: false, message: err.message || 'Export failed' });
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      window.moodmark.ai.hasSession(),
      window.moodmark.ai.usage(),
      window.moodmark.settings.getPrefs(),
      window.moodmark.ai.unindexedCount(),
    ]).then(([sessionExists, u, p, count]) => {
      if (cancelled) return;
      setHasAi(!!sessionExists);
      // Mirror up to App.jsx so AI buttons in DetailPanel etc. light
      // up correctly when this is the first time AI is observed in
      // the session.
      onConfiguredChange?.(!!sessionExists);
      setUsage(u && u.ok ? u : null);
      setPrefs(p);
      setUnindexed(count || 0);
    });
    // Stale transient feedback (the "Erased X saves" / "Exported to
    // …" / etc. lines) shouldn't survive a close + reopen — reset
    // each time the user pops back in.
    setExportState({ running: false, message: null });
    setWipeState({ running: false, message: null });
    return () => { cancelled = true; };
  }, [open]);

  // Progress stream from main while ai:reindex-library runs.
  useEffect(() => {
    if (!open) return;
    return window.moodmark.on('ai:reindex-progress', ({ processed, total }) => {
      setReindexState((s) => ({ ...s, processed, total }));
    });
  }, [open]);

  async function handleReindex() {
    if (reindexState.running || unindexed === 0) return;
    setReindexState({ running: true, processed: 0, total: unindexed });
    const result = await window.moodmark.ai.reindexLibrary();
    setReindexState({
      running: false,
      processed: result?.processed || 0,
      total: result?.total || 0,
    });
    const fresh = await window.moodmark.ai.unindexedCount();
    setUnindexed(fresh || 0);
  }

  async function togglePref(name) {
    const next = !prefs[name];
    const updated = { ...prefs, [name]: next };
    setPrefs(updated);
    await window.moodmark.settings.setPref(name, next);
    onPrefsChange?.(updated);
  }

  // Generic pref setter — used by the new Appearance / Defaults /
  // Capture / Updates / Trash-retention controls below.
  async function updatePref(name, value) {
    const updated = { ...prefs, [name]: value };
    setPrefs(updated);
    await window.moodmark.settings.setPref(name, value);

    // Theme is the only pref whose side-effect needs to be visible
    // before the next app launch — flip the live <html data-theme>
    // attribute so the swap happens during the same frame.
    if (name === 'theme') {
      const resolved = value === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : value;
      document.documentElement.setAttribute('data-theme', resolved);
    }

    onPrefsChange?.(updated);
  }


  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.moodmark.backup.list().then((rows) => {
      if (!cancelled) setSnapshots(Array.isArray(rows) ? rows : []);
    });
    return () => { cancelled = true; };
  }, [open]);

  // Pull the latest license/entitlement view when Settings opens so
  // the Account drawer renders with fresh email + plan + status.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.moodmark.licensing.verify({ force: false }).then((result) => {
      if (!cancelled) setAccount(result || null);
    });
    setPortalState({ running: false, message: null });
    return () => { cancelled = true; };
  }, [open]);

  async function handleOpenCustomerPortal() {
    if (portalState.running) return;
    setPortalState({ running: true, message: null });
    const result = await window.moodmark.licensing.openCustomerPortal();
    setPortalState({
      running: false,
      message: result?.ok
        ? null
        : result?.error === 'no_customer'
          ? 'You don’t have a subscription yet.'
          : 'Couldn’t open the billing portal. Try again in a moment.',
    });
  }

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Sign out of GatherOS?',
      message: 'Your library stays on this Mac. You can sign back in any time with the same email.',
      confirmLabel: 'Sign out',
    });
    if (!ok) return;
    // Route through AppGate so useLicense flips state to unauth in
    // the same tick. Calling the IPC directly here would leave the
    // renderer thinking it was still entitled until the next focus-
    // triggered verify, which is exactly the delay users see.
    window.dispatchEvent(new CustomEvent('moodmark:request-signout'));
    // Closing settings before AppGate flips back to the SigninScreen
    // avoids a brief flash of Settings on top of the new takeover.
    onClose?.();
  }

  async function handleSnapshotNow() {
    if (snapshotState.running) return;
    setSnapshotState({ running: true, message: null });
    const result = await window.moodmark.backup.snapshot();
    const rows = await window.moodmark.backup.list();
    setSnapshots(Array.isArray(rows) ? rows : []);
    setSnapshotState({
      running: false,
      message: result?.ok ? 'Snapshot saved.' : `Snapshot failed: ${result?.reason || 'unknown'}`,
    });
  }

  async function handleRestoreSnapshot(snapshot) {
    const stamp = formatRelativeTimestamp(snapshot.timestamp);
    const ok = await confirm({
      title: `Restore snapshot from ${stamp}?`,
      message:
        "Saves added since that snapshot will disappear from the library. "
        + "The image files on disk are untouched, so nothing is permanently "
        + "lost — re-importing those files would resurface them. A fresh "
        + "snapshot of the current state is taken first as a safety net.",
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setSnapshotState({ running: true, message: null });
    const result = await window.moodmark.backup.restore(snapshot.path);
    const rows = await window.moodmark.backup.list();
    setSnapshots(Array.isArray(rows) ? rows : []);
    setSnapshotState({
      running: false,
      message: result?.ok ? 'Restored. Reloading…' : `Restore failed: ${result?.reason || 'unknown'}`,
    });
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Jump to a specific page when the parent passes a hint (e.g.
  // AppGate's DB-integrity banner aiming the user at Data). The hint
  // is { drawer, key } where key is bumped per dispatch so repeated
  // triggers re-fire even on the same target page.
  useEffect(() => {
    if (!open || !drawerHint) return;
    const valid = NAV_ITEMS.some((p) => p.id === drawerHint.drawer);
    if (valid) setActivePage(drawerHint.drawer);
  }, [open, drawerHint]);

  // Refresh the tag list whenever the Tags page is shown so save_count
  // reflects any tagging changes that happened mid-session.
  useEffect(() => {
    if (!open || activePage !== 'tags') return;
    let cancelled = false;
    window.moodmark?.tags?.getAll().then((rows) => {
      if (!cancelled) setTags(Array.isArray(rows) ? rows : []);
    });
    return () => { cancelled = true; };
  }, [open, activePage]);

  async function handleTagRenameCommit(tag) {
    const next = tagDraft.name.trim().toLowerCase().replace(/^#+/, '');
    if (!next || next === tag.name) {
      setTagDraft({ id: null, name: '' });
      return;
    }
    setTagBusy(true);
    await window.moodmark.tags.rename({ id: tag.id, name: next });
    const rows = await window.moodmark.tags.getAll();
    setTags(Array.isArray(rows) ? rows : []);
    setTagDraft({ id: null, name: '' });
    setTagBusy(false);
  }

  async function handleTagDelete(tag) {
    const ok = await confirm({
      title: `Delete the tag "${tag.name}"?`,
      message: tag.save_count > 0
        ? `It's currently on ${tag.save_count} ${tag.save_count === 1 ? 'save' : 'saves'} — they'll keep the save, just not the tag.`
        : 'This tag isn’t applied to any saves.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setTagBusy(true);
    await window.moodmark.tags.delete(tag.id);
    const rows = await window.moodmark.tags.getAll();
    setTags(Array.isArray(rows) ? rows : []);
    setTagBusy(false);
  }

  async function handleDeleteUnusedTags() {
    const unusedCount = tags.filter((t) => (t.save_count || 0) === 0).length;
    if (unusedCount === 0) return;
    const ok = await confirm({
      title: `Delete ${unusedCount} unused ${unusedCount === 1 ? 'tag' : 'tags'}?`,
      message: "They aren't applied to any saves.",
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setTagBusy(true);
    await window.moodmark.tags.deleteUnused();
    const rows = await window.moodmark.tags.getAll();
    setTags(Array.isArray(rows) ? rows : []);
    setTagBusy(false);
  }

  // Filter + sort the tag list. Search is a substring match against
  // the lowercase name; sort comparators are stable so equal-count
  // rows stay alphabetical. Capped at 200 visible rows by default to
  // keep DOM size bounded on libraries with thousands of tags — the
  // "Show all" link drops the cap when the user opts in.
  const TAG_RENDER_CAP = 200;
  const filteredTags = (() => {
    const q = tagFilter.trim().toLowerCase();
    let rows = q ? tags.filter((t) => t.name.includes(q)) : tags.slice();
    rows.sort((a, b) => {
      if (tagSort === 'name_asc') return a.name.localeCompare(b.name);
      if (tagSort === 'unused_first') {
        const ua = (a.save_count || 0) === 0 ? 0 : 1;
        const ub = (b.save_count || 0) === 0 ? 0 : 1;
        if (ua !== ub) return ua - ub;
        return a.name.localeCompare(b.name);
      }
      // count_desc — most-used first, alpha as tiebreak
      const diff = (b.save_count || 0) - (a.save_count || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
    return rows;
  })();
  const visibleTags = tagShowAll ? filteredTags : filteredTags.slice(0, TAG_RENDER_CAP);
  const unusedTagCount = tags.filter((t) => (t.save_count || 0) === 0).length;

  if (!open) return null;

  return ReactDOM.createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        // Only treat clicks landing directly on the backdrop as a
        // dismiss — don't catch clicks that started inside the
        // modal and bubbled up.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
      >
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >×</button>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarLabel}>Settings</div>
          <nav className={styles.nav}>
            {NAV_ITEMS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`${styles.navItem} ${activePage === id ? styles.navItemActive : ''}`}
                onClick={() => setActivePage(id)}
                aria-current={activePage === id ? 'page' : undefined}
              >
                <span className={styles.navIcon}>
                  <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span className={styles.navLabel}>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className={styles.content}>
          <h2 className={styles.pageTitle}>
            {NAV_ITEMS.find((p) => p.id === activePage)?.label}
          </h2>

          {activePage === 'account' && (
            <div className={styles.page}>
              {account?.state === 'unauth' ? (
                <>
                  <p className={styles.sectionHint}>
                    You're signed out. Sign back in to sync your AI
                    usage and manage your subscription. Your library
                    stays on this Mac either way.
                  </p>
                  <div className={`${styles.actions} ${styles.actionsStart}`} style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('moodmark:request-signin'));
                        onClose?.();
                      }}
                    >
                      Sign in
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.aboutRow}>
                    <span className={styles.aboutLabel}>Email</span>
                    <span className={styles.aboutValue}>
                      {account?.user?.email || '—'}
                    </span>
                  </div>
                  <div className={styles.aboutRow}>
                    <span className={styles.aboutLabel}>Plan</span>
                    <span className={styles.aboutValue}>
                      {formatPlanLabel(account)}
                    </span>
                  </div>
                  {account?.subscription?.current_period_end && (
                    <div className={styles.aboutRow}>
                      <span className={styles.aboutLabel}>
                        {account.subscription.cancel_at_period_end
                          ? 'Ends'
                          : account.subscription.status === 'trialing'
                            ? 'Trial ends'
                            : 'Renews'}
                      </span>
                      <span className={styles.aboutValue}>
                        {formatPeriodEnd(account.subscription.current_period_end)}
                      </span>
                    </div>
                  )}
                  <div className={`${styles.actions} ${styles.actionsStart}`} style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={handleSignOut}
                    >
                      <LogOutIcon size={14} strokeWidth={1.7} aria-hidden="true" />
                      Sign out
                    </button>
                    {account?.subscription && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={handleOpenCustomerPortal}
                        disabled={portalState.running}
                      >
                        <CreditCardIcon size={14} strokeWidth={1.7} aria-hidden="true" />
                        {portalState.running ? 'Opening…' : 'Manage subscription'}
                      </button>
                    )}
                  </div>
                  {portalState.message && (
                    <div className={styles.sectionHint} style={{ marginTop: 8 }}>
                      {portalState.message}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activePage === 'appearance' && (
            <div className={styles.page}>
              <p className={styles.sectionHint}>
                Pick a theme. "System" follows your Mac's appearance
                setting and updates automatically when it changes.
              </p>
              <div className={styles.segmentedRow}>
                {[
                  { value: 'light',  label: 'Light',  Icon: SunIcon },
                  { value: 'dark',   label: 'Dark',   Icon: MoonIcon },
                  { value: 'system', label: 'System', Icon: MonitorIcon },
                ].map(({ value, label, Icon }) => {
                  const active = prefs.theme === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`${styles.segmentBtn} ${active ? styles.segmentBtnActive : ''}`}
                      onClick={() => updatePref('theme', value)}
                      aria-pressed={active}
                    >
                      {active && <Icon size={14} strokeWidth={1.7} aria-hidden="true" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activePage === 'capture' && (
            <div className={styles.page}>
              <p className={styles.sectionHint}>
                Configure the global screenshot shortcut and where
                captures land. Shortcut changes apply on next launch.
              </p>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>Global shortcut</label>
                <ShortcutCapture
                  value={prefs.captureShortcut || DEFAULT_CAPTURE_SHORTCUT}
                  defaultValue={DEFAULT_CAPTURE_SHORTCUT}
                  onChange={(next) => updatePref('captureShortcut', next)}
                />
                <span className={styles.fieldHint}>
                  Captures the next key combo you press. Esc cancels.
                </span>
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>Default mode</label>
                <div className={styles.segmentedRow}>
                  {[
                    { value: 'region',     label: 'Region',     Icon: CropIcon },
                    { value: 'window',     label: 'Window',     Icon: AppWindowIcon },
                    { value: 'fullscreen', label: 'Fullscreen', Icon: MaximizeIcon },
                  ].map(({ value, label, Icon }) => {
                    const active = prefs.captureMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`${styles.segmentBtn} ${active ? styles.segmentBtnActive : ''}`}
                        onClick={() => updatePref('captureMode', value)}
                        aria-pressed={active}
                      >
                        {active && <Icon size={14} strokeWidth={1.8} aria-hidden="true" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>Drop folder</label>
                <FolderPickerRow
                  value={prefs.captureDropFolder}
                  onChange={(next) => updatePref('captureDropFolder', next)}
                />
                <span className={styles.fieldHint}>
                  When set, screenshots also land here as files. Leave
                  empty to keep them in your library only.
                </span>
              </div>
            </div>
          )}

          {activePage === 'updates' && (
            <UpdatesPage
              prefs={prefs}
              updatePref={updatePref}
            />
          )}

          {activePage === 'libraries' && (
            <div className={styles.page}>
              <p className={styles.sectionHint}>
                Each library is its own set of saves, collections, and
                spaces. Switch between them from the toolbar; rename or
                delete any of them here.
              </p>
              <LibrariesPage
                libraries={libraries}
                activeId={activeLibraryId}
                onSwitch={onSwitchLibrary}
                onCreate={onCreateLibrary}
                onRename={onRenameLibrary}
                onDelete={onDeleteLibrary}
              />
            </div>
          )}

          {activePage === 'ai' && (
            <div className={styles.page}>
              <p className={styles.sectionHint}>
                Auto-tagging, auto-titles, semantic search, and image-prompt
                generation run on a managed OpenAI integration that ships
                with your subscription — no API key to set up.
              </p>

              {!hasAi && (
                <div className={styles.statusRow}>
                  <span className={`${styles.status} ${styles.statusMuted}`}>
                    Sign in to unlock AI features
                  </span>
                </div>
              )}

              {hasAi && usage && (
                <UsageMeter usage={usage} />
              )}

              <div className={styles.divider} />

              <div className={styles.toggleRow}>
                <span className={styles.toggleText}>
                  <span className={styles.toggleLabel}>Auto-name new uploads</span>
                  <span className={styles.toggleSub}>
                    Generate a short title for each image you save. Runs in the background.
                  </span>
                </span>
                <ToggleSwitch
                  on={hasAi && !!prefs.autoNameOnSave}
                  onChange={() => togglePref('autoNameOnSave')}
                />
              </div>
              <div className={styles.toggleRow}>
                <span className={styles.toggleText}>
                  <span className={styles.toggleLabel}>Visual search</span>
                  <span className={styles.toggleSub}>
                    Index new saves with vector embeddings so the search bar matches by meaning ("dark moody UI") instead of exact words.
                  </span>
                </span>
                <ToggleSwitch
                  on={hasAi && !!prefs.semanticSearch}
                  onChange={() => togglePref('semanticSearch')}
                />
              </div>

              {hasAi && (unindexed > 0 || reindexState.running) && (
                <div className={styles.reindexBox}>
                  <div className={styles.reindexCopy}>
                    {reindexState.running ? (
                      <>
                        <strong>Indexing {reindexState.processed} of {reindexState.total}…</strong>
                        <span className={styles.toggleSub}>
                          Each save runs one vision call plus one embedding. You can keep using the app.
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>{unindexed} {unindexed === 1 ? 'save needs' : 'saves need'} indexing</strong>
                        <span className={styles.toggleSub}>
                          Older saves won't appear in semantic results until they're processed.
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleReindex}
                    disabled={reindexState.running || unindexed === 0}
                  >
                    {reindexState.running ? 'Indexing…' : 'Index now'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activePage === 'tags' && (
            <div className={styles.page}>
              {tags.length === 0 ? (
                <div className={styles.sectionHint}>
                  No tags yet. Add tags to a save from its detail panel.
                </div>
              ) : (
                <>
                  <div className={styles.tagControls}>
                    <input
                      type="search"
                      className={styles.tagSearch}
                      placeholder="Search tags…"
                      value={tagFilter}
                      onChange={(e) => {
                        setTagFilter(e.target.value);
                        setTagShowAll(false);
                      }}
                    />
                    <select
                      className={styles.select}
                      value={tagSort}
                      onChange={(e) => setTagSort(e.target.value)}
                      aria-label="Sort tags"
                    >
                      <option value="count_desc">Most used</option>
                      <option value="name_asc">A → Z</option>
                      <option value="unused_first">Unused first</option>
                    </select>
                  </div>

                  <div className={styles.tagSummaryRow}>
                    <span className={styles.tagSummary}>
                      {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
                      {unusedTagCount > 0 && (
                        <> · {unusedTagCount} unused</>
                      )}
                      {tagFilter && (
                        <> · {filteredTags.length} match{filteredTags.length === 1 ? '' : 'es'}</>
                      )}
                    </span>
                    {unusedTagCount > 0 && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnDanger}`}
                        onClick={handleDeleteUnusedTags}
                        disabled={tagBusy}
                      >
                        <Trash2 size={13} strokeWidth={1.7} aria-hidden="true" />
                        Delete unused
                      </button>
                    )}
                  </div>

                  {filteredTags.length === 0 ? (
                    <div className={styles.sectionHint}>
                      No tags match "{tagFilter}".
                    </div>
                  ) : (
                    <ul className={styles.tagList}>
                      {visibleTags.map((t) => {
                        const renaming = tagDraft.id === t.id;
                        return (
                          <li key={t.id} className={styles.tagRow}>
                            {renaming ? (
                              <input
                                autoFocus
                                className={styles.tagInput}
                                value={tagDraft.name}
                                disabled={tagBusy}
                                onChange={(e) => setTagDraft({ id: t.id, name: e.target.value })}
                                onBlur={() => handleTagRenameCommit(t)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleTagRenameCommit(t);
                                  if (e.key === 'Escape') setTagDraft({ id: null, name: '' });
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className={styles.tagName}
                                onClick={() => setTagDraft({ id: t.id, name: t.name })}
                                title="Rename tag"
                              >
                                <span className={styles.tagHash}>#</span>{t.name}
                              </button>
                            )}
                            <span className={styles.tagCount}>
                              {t.save_count} {t.save_count === 1 ? 'save' : 'saves'}
                            </span>
                            <button
                              type="button"
                              className={styles.tagDeleteBtn}
                              onClick={() => handleTagDelete(t)}
                              disabled={tagBusy}
                              aria-label={`Delete tag ${t.name}`}
                              title={`Delete tag ${t.name}`}
                            >
                              <Trash2 size={13} strokeWidth={1.7} aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {!tagShowAll && filteredTags.length > TAG_RENDER_CAP && (
                    <button
                      type="button"
                      className={styles.tagShowAll}
                      onClick={() => setTagShowAll(true)}
                    >
                      Show all {filteredTags.length} tags
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {activePage === 'data' && (
            <div className={styles.page}>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  Auto-empty trash
                </label>
                <select
                  className={styles.select}
                  value={prefs.trashAutoEmptyDays ?? 0}
                  onChange={(e) => updatePref('trashAutoEmptyDays', Number(e.target.value))}
                >
                  <option value={0}>Never</option>
                  <option value={7}>After 7 days</option>
                  <option value={14}>After 14 days</option>
                  <option value={30}>After 30 days</option>
                  <option value={90}>After 90 days</option>
                </select>
                <span className={styles.fieldHint}>
                  Soft-deleted saves are permanently removed on
                  launch once they exceed the retention period.
                </span>
              </div>

              <p className={styles.sectionHint}>
            Export your entire library — the GatherOS database plus every
            saved image and thumbnail — into a single .zip backup. You can
            restore later by replacing the contents of the app's data
            folder with this archive's contents.
          </p>
          <div className={`${styles.actions} ${styles.actionsStart}`}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnWithIcon}`}
              onClick={handleExportLibrary}
              disabled={exportState.running}
            >
              <FileArchiveIcon size={14} strokeWidth={1.5} aria-hidden="true" />
              {exportState.running ? 'Exporting…' : 'Export library as zip'}
            </button>
          </div>
          {exportState.message && (
            <div className={styles.sectionHint} style={{ marginTop: 8 }}>
              {exportState.message}
            </div>
          )}

          <div className={styles.divider} />

          <p className={styles.sectionHint}>
            GatherOS saves daily snapshots of your library so you can
            restore if necessary.
          </p>
          <div className={`${styles.actions} ${styles.actionsStart}`} style={{ marginBottom: 6 }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnWithIcon}`}
              onClick={handleSnapshotNow}
              disabled={snapshotState.running}
            >
              <span className={styles.btnIcon}>
                <History size={14} strokeWidth={1.7} aria-hidden="true" />
              </span>
              {snapshotState.running ? 'Working…' : 'Snapshot now'}
            </button>
          </div>
          {snapshots.length > 0 ? (
            <div className={styles.subDrawer}>
              <button
                type="button"
                className={styles.subDrawerHeader}
                onClick={() => setSnapshotsListOpen((v) => !v)}
                aria-expanded={snapshotsListOpen}
              >
                <span>Available snapshots ({snapshots.length})</span>
                <span
                  className={[
                    styles.drawerChevron,
                    snapshotsListOpen && styles.drawerChevronOpen,
                  ].filter(Boolean).join(' ')}
                >
                  <DrawerChevron />
                </span>
              </button>
              {snapshotsListOpen && (
                <ul className={styles.snapshotList}>
                  {snapshots.map((s) => (
                    <li key={s.path} className={styles.snapshotRow}>
                      <div className={styles.snapshotMeta}>
                        <span className={styles.snapshotWhen}>
                          {s.kind === 'migration'
                            ? `Pre-update backup (v${s.migrationToVersion})`
                            : formatRelativeTimestamp(s.timestamp)}
                        </span>
                        <span className={styles.snapshotSub}>
                          {new Date(s.timestamp).toLocaleString()}
                          {' · '}{formatBackupSize(s.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.btn}
                        disabled={snapshotState.running}
                        onClick={() => handleRestoreSnapshot(s)}
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className={styles.sectionHint} style={{ marginTop: 4 }}>
              No snapshots yet. The first one will be taken automatically
              within a moment.
            </div>
          )}
          {snapshotState.message && (
            <div className={styles.sectionHint} style={{ marginTop: 8 }}>
              {snapshotState.message}
            </div>
          )}

          <div className={styles.divider} />

          <p className={styles.sectionHint}>
            Erase your entire library — every save, collection, and tag. The
            underlying image files are deleted from disk. This cannot be
            undone.
          </p>
          <div className={`${styles.actions} ${styles.actionsStart}`}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger} ${styles.btnWithIcon}`}
              onClick={handleWipeLibrary}
              disabled={wipeState.running}
            >
              <EraserIcon size={14} strokeWidth={1.5} aria-hidden="true" />
              {wipeState.running ? 'Erasing…' : 'Erase library'}
            </button>
          </div>
              {wipeState.message && (
                <div className={styles.sectionHint} style={{ marginTop: 8 }}>
                  {wipeState.message}
                </div>
              )}
            </div>
          )}

          {activePage === 'about' && (
            <div className={styles.page}>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Version</span>
              <span className={styles.aboutValue}>
                {appVersion ? `v${appVersion}` : '—'}
              </span>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Privacy</span>
              <button
                type="button"
                className={styles.aboutLink}
                onClick={() => setPrivacyOpen(true)}
              >
                View policy
              </button>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Support</span>
              <button
                type="button"
                className={styles.aboutLink}
                onClick={() => window.moodmark.shell.openUrl(`mailto:${SUPPORT_EMAIL}`)}
              >
                {SUPPORT_EMAIL}
              </button>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Open source</span>
              <button
                type="button"
                className={styles.aboutLink}
                onClick={() => setAcksOpen(true)}
              >
                View acknowledgments
              </button>
            </div>
            </div>
          )}
        </main>
      </div>

      <AcknowledgmentsModal
        open={acksOpen}
        onClose={() => setAcksOpen(false)}
      />

      <PrivacyModal
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
      />
    </div>,
    document.body,
  );
}

// "5 minutes ago" / "2 hours ago" / "3 days ago" — used for the
// backup snapshot list so each row reads at a glance.
function formatRelativeTimestamp(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) {
    const m = Math.max(1, Math.round(diff / min));
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < day) {
    const h = Math.round(diff / hour);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.round(diff / day);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function formatBackupSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

