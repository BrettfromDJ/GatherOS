import React, { useState } from 'react';
import styles from './AccountBanner.module.css';

// Floating notification pill rendered above the app shell when the
// license has something the user needs to know — currently:
//   - past_due: card declined; user needs to update payment method
//   - offline:  the desktop app is running on a stale cached license
//
// Both are explicitly non-dismissible: past_due needs action, and the
// offline banner disappears on its own as soon as a verify succeeds.
export default function AccountBanner({ license, onOpenCustomerPortal }) {
  const [opening, setOpening] = useState(false);

  if (!license) return null;

  // past_due trumps offline if both are true.
  if (license.subscription?.status === 'past_due') {
    async function handleUpdate() {
      if (opening) return;
      setOpening(true);
      try {
        await onOpenCustomerPortal?.();
      } finally {
        setOpening(false);
      }
    }
    return (
      <div className={`${styles.banner} ${styles.bannerWarn}`}>
        <span className={`${styles.dot} ${styles.dotWarn}`} />
        <span className={styles.text}>
          We couldn’t charge your card.
        </span>
        <button
          type="button"
          className={styles.action}
          onClick={handleUpdate}
          disabled={opening}
        >
          {opening ? 'Opening…' : 'Update payment method'}
        </button>
      </div>
    );
  }

  if (license.state === 'offline') {
    return (
      <div className={`${styles.banner} ${styles.bannerInfo}`}>
        <span className={`${styles.dot} ${styles.dotInfo}`} />
        <span className={styles.text}>
          Working offline — license will refresh when you’re back online.
        </span>
      </div>
    );
  }

  return null;
}
