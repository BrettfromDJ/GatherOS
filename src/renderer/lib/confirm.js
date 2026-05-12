// Imperative confirm() backed by a single host component (mount
// <ConfirmHost /> once near the app root). Returns a Promise that
// resolves with the user's choice. Use anywhere a window.confirm
// would have lived, just await it.

const listeners = new Set();
let pendingResolve = null;

export function confirm(opts) {
  return new Promise((resolve) => {
    if (pendingResolve) pendingResolve(false);
    pendingResolve = resolve;
    listeners.forEach((fn) => fn(opts || {}));
  });
}

export function _subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function _resolve(value) {
  const r = pendingResolve;
  pendingResolve = null;
  if (r) r(value);
}
