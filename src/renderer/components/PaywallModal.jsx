import React from 'react';
import styles from './PaywallModal.module.css';

// Full-screen paywall shown when the user's trial has lapsed and
// there's no active paid subscription. Blocks the rest of the app.
//
// The Subscribe buttons currently no-op with a TODO toast — Paddle
// checkout wiring lands in Phase 3c. Sign-out is wired so a user
// who wants to switch accounts isn't stuck.
export default function PaywallModal({ license, onSignOut, onSubscribe }) {
  const trialEndedAgo = license?.trial_ends_at
    ? Math.max(0, Math.round((Date.now() - license.trial_ends_at) / (24 * 60 * 60 * 1000)))
    : null;

  return (
    <div className={styles.scrim}>
      <div className={styles.card}>
        <div className={styles.brand}>GatherOS</div>
        <h1 className={styles.heading}>Your trial has ended</h1>
        <p className={styles.body}>
          {trialEndedAgo !== null && trialEndedAgo > 0
            ? `Your 30-day trial ended ${trialEndedAgo} day${trialEndedAgo === 1 ? '' : 's'} ago.`
            : 'Your 30-day trial just ended.'}{' '}
          Subscribe to keep using GatherOS — your library, boards, and AI
          settings are exactly as you left them.
        </p>

        <div className={styles.plans}>
          <button
            type="button"
            className={`${styles.plan} ${styles.planFeatured}`}
            onClick={() => onSubscribe?.('yearly')}
          >
            <div className={styles.planLabel}>Yearly</div>
            <div className={styles.planPrice}>$49<span className={styles.planUnit}>/yr</span></div>
            <div className={styles.planNote}>Save ~18% — about $4.08/mo</div>
          </button>
          <button
            type="button"
            className={styles.plan}
            onClick={() => onSubscribe?.('monthly')}
          >
            <div className={styles.planLabel}>Monthly</div>
            <div className={styles.planPrice}>$5<span className={styles.planUnit}>/mo</span></div>
            <div className={styles.planNote}>Cancel anytime</div>
          </button>
        </div>

        <p className={styles.fineprint}>
          Billing is handled securely by Paddle. You can cancel from your
          account at any time.
        </p>

        <button type="button" className={styles.signOutLink} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
