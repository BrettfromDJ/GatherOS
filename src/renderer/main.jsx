import React from 'react';
import { createRoot } from 'react-dom/client';
import AppGate from './AppGate.jsx';
import { OnboardingProvider } from './onboarding/OnboardingContext.jsx';
// Geist variable fonts — bundled locally via @fontsource-variable
// so the app works fully offline. Loaded before our own styles so
// the @font-face declarations are registered before anything tries
// to use --font-ui / --font-mono.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/variables.css';
import './styles/global.css';

// Apply the persisted theme before the first paint. The value is
// pulled synchronously in the preload via ipcRenderer.sendSync, so
// the right palette is in place before any React markup mounts.
//
// 'system' resolves to the OS preference via matchMedia, and the
// listener below keeps the attribute in sync if the OS appearance
// changes while the app is open. 'light' / 'dark' are honored as
// explicit overrides.
function resolveTheme(value) {
  if (value === 'dark' || value === 'light') return value;
  // 'system' or anything else → follow the OS.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

const storedTheme = window.moodmark?.app?.theme || 'system';
document.documentElement.setAttribute('data-theme', resolveTheme(storedTheme));

// Keep tracking the OS preference whenever the user is on 'system'.
// We re-read the current pref on every change rather than caching so
// flipping the Settings → Appearance picker takes effect without a
// page reload.
const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
mql?.addEventListener?.('change', () => {
  const current = window.moodmark?.app?.themePref?.() || 'system';
  if (current === 'system') {
    document.documentElement.setAttribute(
      'data-theme',
      mql.matches ? 'dark' : 'light',
    );
  }
});

const container = document.getElementById('root');
createRoot(container).render(
  <React.StrictMode>
    <OnboardingProvider>
      <AppGate />
    </OnboardingProvider>
  </React.StrictMode>,
);
