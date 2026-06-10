import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import styles from './UpgradeModal.module.css';
import brandIconUrl from '../assets/welcome-icon.svg';
import { PENDING_UPGRADE_KEY } from '../context/entitlement.jsx';

// Per-feature copy. The `feature` prop is set by whatever action was
// blocked (a locked save, an AI button, etc.) so the headline speaks to
// what the user just tried to do. Falls back to the generic pitch.
const COPY = {
  save: {
    heading: 'Upgrade to keep saving',
    body: 'Everything you’ve already saved stays right here. Upgrade to add new saves and unlock every pro feature.',
  },
  ai: {
    heading: 'Unlock AI features',
    body: 'Image generation, “more like this”, auto-tagging and visual search are part of GatherOS pro. Upgrade to turn them on.',
  },
  'x-sync': {
    heading: 'Unlock X bookmark sync',
    body: 'Keep your X bookmarks flowing into your library automatically. Upgrade to enable sync.',
  },
  libraries: {
    heading: 'Unlock multiple libraries',
    body: 'Keep separate libraries for separate projects. Upgrade to add as many as you like.',
  },
  boards: {
    heading: 'Unlock boards',
    body: 'Arrange your saves into freeform boards and spaces. Upgrade to start building them.',
  },
  default: {
    heading: 'Upgrade to GatherOS',
    body: 'Unlock unlimited saves, every AI feature, X bookmark sync, multiple libraries and boards.',
  },
};

// Dismissible upgrade modal. Replaces the old hard PaywallModal — the
// app keeps running underneath; this just sells the upgrade. When the
// user isn't signed in we route them through sign-in first (a paid
// subscription has to attach to an account), otherwise we open the
// hosted checkout directly.
export default function UpgradeModal({ open, feature, entitlement, onClose }) {
  const [interval, setInterval] = useState('monthly');
  const [opening, setOpening] = useState(false);
  const [hasAccount, setHasAccount] = useState(true);

  // Resolve sign-in state whenever the modal opens so we know whether to
  // show "sign in to upgrade" or jump straight to checkout.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.moodmark?.licensing?.hasSession?.()
      .then((v) => { if (!cancelled) setHasAccount(!!v); })
      .catch(() => { if (!cancelled) setHasAccount(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Close on Escape — it's a soft modal, not a wall.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copy = COPY[feature] || COPY.default;
  const price = interval === 'yearly' ? '$49' : '$4.99';
  const unit = interval === 'yearly' ? '/yr' : '/mo';
  const subnote = interval === 'yearly'
    ? 'Billed yearly — save ~18%. Cancel anytime.'
    : 'Billed monthly. Cancel anytime.';

  async function handleUpgrade() {
    if (opening) return;
    setOpening(true);
    try {
      if (!hasAccount) {
        // No account yet — checkout has to attach to one. Remember the
        // upgrade intent (plan they picked) so AppGate can continue
        // straight to checkout the moment sign-in lands, then send them
        // to the sign-in screen.
        try {
          localStorage.setItem(
            PENDING_UPGRADE_KEY,
            JSON.stringify({ plan: interval, feature: feature || null }),
          );
        } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('moodmark:request-signin'));
        onClose?.();
        return;
      }
      const result = await window.moodmark.licensing.openCheckout(interval);
      if (result?.ok) {
        // Tell AppGate to fast-poll verify so we flip to paid as soon as
        // the subscription webhook lands.
        window.dispatchEvent(new CustomEvent('moodmark:checkout-opened'));
      } else {
        console.error('[upgrade] openCheckout failed:', result?.error);
      }
    } finally {
      setTimeout(() => setOpening(false), 1500);
    }
  }

  const ctaLabel = opening
    ? 'Opening…'
    : hasAccount
      ? 'Upgrade now'
      : 'Sign in to upgrade';

  return (
    <div className={styles.scrim} onMouseDown={onClose}>
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} strokeWidth={2} aria-hidden />
        </button>

        <img
          className={styles.brand}
          src={brandIconUrl}
          alt="GatherOS"
          draggable={false}
        />
        <h1 className={styles.heading}>{copy.heading}</h1>
        <p className={styles.body}>{copy.body}</p>

        <div className={styles.toggle} role="tablist" aria-label="Billing interval">
          <button
            type="button"
            role="tab"
            aria-selected={interval === 'monthly'}
            className={`${styles.toggleSeg} ${interval === 'monthly' ? styles.toggleSegActive : ''}`}
            onClick={() => setInterval('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={interval === 'yearly'}
            className={`${styles.toggleSeg} ${interval === 'yearly' ? styles.toggleSegActive : ''}`}
            onClick={() => setInterval('yearly')}
          >
            Yearly
          </button>
        </div>

        <div className={styles.priceRow} aria-live="polite">
          <span className={styles.price}>{price}</span>
          <span className={styles.priceUnit}>{unit}</span>
        </div>
        <div className={styles.priceNote}>{subnote}</div>

        <button
          type="button"
          className={styles.cta}
          disabled={opening}
          onClick={handleUpgrade}
        >
          {ctaLabel}
        </button>

        <button type="button" className={styles.notNow} onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
