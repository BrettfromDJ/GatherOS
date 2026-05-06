import React, { useState } from 'react';
import styles from './SigninScreen.module.css';

// Full-screen signin / magic-link request. Rendered as the only
// thing the user sees when there's no session — the rest of the app
// is mounted but visually obscured.
//
// Two states:
//   form  — email input + "Send magic link" button
//   sent  — confirmation, "Check your email"
export default function SigninScreen({ onRequestMagicLink }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await onRequestMagicLink(email.trim().toLowerCase());
    setSending(false);
    if (result?.ok) {
      setSent(true);
    } else {
      setError(
        result?.error === 'invalid_email'
          ? 'That email address looks invalid.'
          : 'Couldn’t reach the server. Try again in a moment.',
      );
    }
  }

  return (
    <div className={styles.scrim}>
      <div className={styles.card}>
        <div className={styles.brand}>GatherOS</div>
        {sent ? (
          <div className={styles.sentBlock}>
            <h1 className={styles.heading}>Check your email</h1>
            <p className={styles.body}>
              We sent a sign-in link to <strong>{email}</strong>. Click it
              from this device to finish signing in.
            </p>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                setSent(false);
                setEmail('');
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <h1 className={styles.heading}>Sign in to continue</h1>
            <p className={styles.body}>
              Enter your email and we’ll send you a magic sign-in link —
              no passwords. Your 30-day free trial starts the moment you
              sign in for the first time.
            </p>
            <input
              className={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <div className={styles.error}>{error}</div>}
            <button
              type="submit"
              className={styles.submit}
              disabled={sending || !email}
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
