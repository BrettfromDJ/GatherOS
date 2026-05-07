import React from 'react';
import styles from './PaywallModal.module.css';

// Full-screen paywall shown when the user has no active subscription.
// Blocks the rest of the app.
//
// onSubscribe(plan) opens the Paddle.js checkout overlay (wired up
// in AppGate). Buttons disable while Paddle.js is still loading so
// a click can't no-op silently.
//
// Headline + body copy adapt to whether the user previously had a
// real trial period (trial_ends_at far enough in the past) vs. a
// fresh user landing here on first sign-in (trial_ends_at ≈ now).
export default function PaywallModal({
  license,
  onSignOut,
  onSubscribe,
  canSubscribe = true,
}) {
  // Treat anything more than a day in the past as "had a real trial".
  // Brand-new accounts get trial_ends_at = now, so this filters them
  // out and keeps the copy honest.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const trialEndedAgoDays =
    license?.trial_ends_at && Date.now() - license.trial_ends_at > ONE_DAY_MS
      ? Math.round((Date.now() - license.trial_ends_at) / ONE_DAY_MS)
      : null;

  const heading = trialEndedAgoDays !== null
    ? 'Your trial has ended'
    : 'Subscribe to GatherOS';

  const subhead = trialEndedAgoDays !== null
    ? `Your trial ended ${trialEndedAgoDays} day${trialEndedAgoDays === 1 ? '' : 's'} ago. Pick a plan to keep using GatherOS — your library, boards, and AI settings are exactly as you left them.`
    : 'Try free for 30 days, then keep going for $5/mo or $49/yr. Cancel anytime, no charge during the trial.';

  return (
    <div className={styles.scrim}>
      <div className={styles.card}>
        <div className={styles.brand}>GatherOS</div>
        <h1 className={styles.heading}>{heading}</h1>
        <p className={styles.body}>{subhead}</p>

        <div className={styles.plans}>
          <button
            type="button"
            className={`${styles.plan} ${styles.planFeatured}`}
            disabled={!canSubscribe}
            onClick={() => onSubscribe?.('yearly')}
          >
            <div className={styles.planLabel}>Yearly</div>
            <div className={styles.planPrice}>$49<span className={styles.planUnit}>/yr</span></div>
            <div className={styles.planNote}>Save ~18% — about $4.08/mo</div>
          </button>
          <button
            type="button"
            className={styles.plan}
            disabled={!canSubscribe}
            onClick={() => onSubscribe?.('monthly')}
          >
            <div className={styles.planLabel}>Monthly</div>
            <div className={styles.planPrice}>$5<span className={styles.planUnit}>/mo</span></div>
            <div className={styles.planNote}>Cancel anytime</div>
          </button>
        </div>

        <p className={styles.fineprint}>
          Billing is handled securely by Paddle. Cancel any time from
          your account.
        </p>

        <button type="button" className={styles.signOutLink} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
