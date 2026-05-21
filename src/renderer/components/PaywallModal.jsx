import React, { useState } from 'react';
import styles from './PaywallModal.module.css';
import brandIconUrl from '../assets/welcome-icon.svg';

// Full-screen paywall shown when the user has no active subscription.
// Blocks the rest of the app.
//
// onSubscribe(plan) is async — it asks main to create an LS checkout
// URL and open it in the user's default browser. While that round-
// trip is in flight (~hundred ms), we lock the button and show an
// "Opening…" state so a second click can't fire a duplicate checkout.
//
// `license` is no longer consulted for trial-vs-paid copy: we always
// show "Subscribe to GatherOS" so the messaging stays consistent
// whether the user is brand new (sign-in straight to paywall, CC
// captured upfront before app access) or returning after a paused
// subscription. Backend (LS product + worker) is the source of truth
// for whether they need to pay.
export default function PaywallModal({ onSignOut, onSubscribe }) {
  const [interval, setInterval] = useState('monthly');
  const [opening, setOpening] = useState(false);

  async function handleSubscribe() {
    if (opening) return;
    setOpening(true);
    try {
      await onSubscribe?.(interval);
    } finally {
      // Re-enable after a beat — the user is now on the LS checkout
      // page in their browser; clicking again here would just open
      // a duplicate checkout, which we want to discourage.
      setTimeout(() => setOpening(false), 1500);
    }
  }

  const price = interval === 'yearly' ? '$49' : '$4.99';
  const unit = interval === 'yearly' ? '/yr' : '/mo';
  const subnote = interval === 'yearly'
    ? 'Free for 14 days, then $49/yr — save ~18%'
    : 'Free for 14 days, then $4.99/mo — cancel anytime';

  return (
    <div className={styles.scrim}>
      <div className={styles.card}>
        <img
          className={styles.brand}
          src={brandIconUrl}
          alt="GatherOS"
          draggable={false}
        />
        <h1 className={styles.heading}>Start your 14-day free trial</h1>
        <p className={styles.body}>
          Full access to GatherOS for 14 days.<br />
          We&rsquo;ll only charge your card if you keep going.
        </p>

        <div
          className={styles.toggle}
          role="tablist"
          aria-label="Billing interval"
        >
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

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            disabled={opening}
            onClick={handleSubscribe}
          >
            {opening ? 'Opening…' : 'Start 14-day free trial'}
          </button>

          <button type="button" className={styles.signOutLink} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
