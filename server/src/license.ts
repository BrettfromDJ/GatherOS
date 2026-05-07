// License / entitlement endpoint.
//
// The desktop app calls GET /license/verify on launch (and on a
// periodic refresh, every few hours). It expects:
//
//   {
//     ok: true,
//     entitled: boolean,
//     reason: 'trial' | 'subscription' | 'expired',
//     trial_ends_at?: number,
//     subscription?: { status, plan, current_period_end, cancel_at_period_end }
//   }
//
// The renderer caches this in the OS keychain with a 7-day offline
// grace window — see PHASE 3 in MONETIZATION.md.

import { Hono } from 'hono';
import type { Env, SubscriptionRow } from './types';
import { bearer, userFromSession } from './auth';

export const licenseRoutes = new Hono<{ Bindings: Env }>();

const ENTITLED_SUB_STATUSES = new Set<SubscriptionRow['status']>([
  'active',
  'past_due', // grace window — Paddle dunning will eventually flip to canceled
  'trialing', // unused for now (we run the trial pre-Paddle), but harmless
]);

licenseRoutes.get('/verify', async (c) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  const user = await userFromSession(c.env, token);
  if (!user) return c.json({ ok: false, error: 'unauthenticated' }, 401);

  const now = Date.now();

  // Latest subscription row (there's usually exactly one per user;
  // if a user re-subscribed we keep history but the most recent wins).
  const sub = await c.env.DB.prepare(
    `SELECT id, user_id, paddle_subscription_id, status, plan,
            current_period_start, current_period_end,
            cancel_at_period_end, canceled_at, created_at, updated_at
       FROM subscriptions
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
  )
    .bind(user.id)
    .first<SubscriptionRow>();

  const inTrial = user.trial_ends_at > now;
  const entitledViaSub = !!sub && ENTITLED_SUB_STATUSES.has(sub.status);

  let reason: 'trial' | 'subscription' | 'expired';
  if (entitledViaSub) reason = 'subscription';
  else if (inTrial) reason = 'trial';
  else reason = 'expired';

  return c.json({
    ok: true,
    entitled: entitledViaSub || inTrial,
    reason,
    trial_ends_at: user.trial_ends_at,
    subscription: sub
      ? {
          status: sub.status,
          plan: sub.plan,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end === 1,
        }
      : null,
    user: { id: user.id, email: user.email },
  });
});

// Paddle-hosted customer portal — billing history, payment method
// updates, plan changes, cancellation. We mint a fresh portal URL on
// every request rather than caching, since Paddle's URLs are short-
// lived (1 hour) and bound to a session id.
licenseRoutes.post('/customer-portal', async (c) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  const user = await userFromSession(c.env, token);
  if (!user) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  if (!user.paddle_customer_id) {
    // Hasn't checked out yet — there's nothing to manage. The renderer
    // should hide the link for users in this state, but we belt-and-
    // brace here too.
    return c.json({ ok: false, error: 'no_customer' }, 400);
  }

  const apiBase =
    c.env.PADDLE_ENV === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';

  try {
    const res = await fetch(
      `${apiBase}/customers/${user.paddle_customer_id}/portal-sessions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.PADDLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      data?: { urls?: { general?: { overview?: string } } };
      error?: { detail?: string };
    };
    if (!res.ok) {
      console.error('[license] paddle portal-sessions failed:', body);
      return c.json({ ok: false, error: 'paddle_error' }, 502);
    }
    const url = body.data?.urls?.general?.overview;
    if (!url) {
      console.error('[license] paddle portal-sessions response missing overview url:', body);
      return c.json({ ok: false, error: 'paddle_response' }, 502);
    }
    return c.json({ ok: true, url });
  } catch (err) {
    console.error('[license] customer-portal network error:', err);
    return c.json({ ok: false, error: 'network' }, 502);
  }
});
