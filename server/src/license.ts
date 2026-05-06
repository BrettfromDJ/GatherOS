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
