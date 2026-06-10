import React, { useState } from 'react';
import styles from './UpgradeBanner.module.css';

// Floating pill at the bottom of the app that nudges the user toward
// upgrading. Two flavours, driven by entitlement.mode:
//
//   'free'  → persistent: "You're on the free plan — upgrade to keep
//             saving." Can't be dismissed; it's the standing reminder
//             that new saves are locked.
//   'trial' → gentle countdown, only in the final stretch (≤5 days
//             left), and dismissible for the session so it doesn't nag.
//
// 'paid' (and early trial) renders nothing.
export default function UpgradeBanner({ entitlement, onUpgrade }) {
  const [dismissed, setDismissed] = useState(false);

  const mode = entitlement?.mode || 'trial';
  const daysLeft = entitlement?.trial?.daysLeft ?? null;
  // Only the LOCAL no-account trial gets a countdown. A user whose access
  // comes from the server (a paid sub still in its Lemon Squeezy trial, or
  // any server-granted trial) is mode 'trial' but their local clock is
  // spent — without this guard they'd see a bogus "your trial ends" nag.
  const localTrialActive = !!entitlement?.trial?.active;

  if (mode === 'paid') return null;

  if (mode === 'free') {
    return (
      <div className={styles.banner}>
        <span className={styles.text}>
          You’re on the free plan — upgrade to keep saving.
        </span>
        <button type="button" className={styles.action} onClick={onUpgrade}>
          Upgrade
        </button>
      </div>
    );
  }

  // trial — only nudge in the final stretch of the live local trial, and
  // let it be dismissed. Server-backed trials (incl. a paid sub mid LS
  // trial) never show this countdown.
  if (dismissed) return null;
  if (!localTrialActive) return null;
  if (daysLeft == null || daysLeft > 5) return null;

  const dayWord = daysLeft === 1 ? 'day' : 'days';
  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        {daysLeft > 0
          ? `Trial: ${daysLeft} ${dayWord} left`
          : 'Your trial ends today'}
      </span>
      <button type="button" className={styles.action} onClick={onUpgrade}>
        Upgrade
      </button>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
