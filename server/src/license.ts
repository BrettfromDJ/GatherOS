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
import {
  upsertSubscription,
  linkCustomerToUser,
  type LSSubscriptionAttributes,
} from './lemonsqueezy';
import { rowEntitles } from './rules';

export const licenseRoutes = new Hono<{ Bindings: Env }>();

licenseRoutes.get('/verify', async (c) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  const user = await userFromSession(c.env, token);
  if (!user) return c.json({ ok: false, error: 'unauthenticated' }, 401);

  const now = Date.now();

  // ALL of the user's subscription rows. A user can accumulate more
  // than one (re-subscribe, plan switch, or a superseded subscription
  // that later got a trailing cancel/expire webhook). Entitlement must
  // be "does ANY subscription currently entitle them" — the old code
  // trusted only the most-recently-updated row, so a trailing event on
  // a dead subscription could drop a paying user to free.
  const subsResult = await c.env.DB.prepare(
    `SELECT id, user_id, lemonsqueezy_subscription_id, status, plan,
            current_period_start, current_period_end,
            cancel_at_period_end, canceled_at, created_at, updated_at
       FROM subscriptions
      WHERE user_id = ?
      ORDER BY updated_at DESC`,
  )
    .bind(user.id)
    .all<SubscriptionRow>();
  const rows = subsResult.results ?? [];

  const entitlingRows = rows.filter((r) => rowEntitles(r, now));
  const entitledViaSub = entitlingRows.length > 0;

  // Which subscription to report back for display. Prefer a real paid
  // one (non-trialing entitling row with the furthest period end — the
  // live subscription), then any entitling row, then the most-recent
  // row so the client can still show status/plan for an expired user.
  const sub =
    entitlingRows
      .filter((r) => r.status !== 'trialing')
      .sort((a, b) => (b.current_period_end ?? 0) - (a.current_period_end ?? 0))[0]
    || entitlingRows[0]
    || rows[0]
    || null;

  const inTrial = user.trial_ends_at > now;

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

// Lemon Squeezy customer portal — billing history, payment method
// updates, plan changes, cancellation. We hit GET /v1/customers/{id}
// and pull the portal URL off the customer object on every request
// rather than caching, since LS's URLs are short-lived.
licenseRoutes.post('/customer-portal', async (c) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  const user = await userFromSession(c.env, token);
  if (!user) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  if (!user.lemonsqueezy_customer_id) {
    return c.json({ ok: false, error: 'no_customer' }, 400);
  }

  try {
    const res = await fetch(
      `https://api.lemonsqueezy.com/v1/customers/${user.lemonsqueezy_customer_id}`,
      {
        method: 'GET',
        headers: lsHeaders(c.env.LEMONSQUEEZY_API_KEY),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      data?: { attributes?: { urls?: { customer_portal?: string } } };
    };
    if (!res.ok) {
      console.error('[license] LS customer GET failed:', body);
      return c.json({ ok: false, error: 'lemonsqueezy_error' }, 502);
    }
    const url = body.data?.attributes?.urls?.customer_portal;
    if (!url) {
      console.error('[license] LS customer response missing portal url:', body);
      return c.json({ ok: false, error: 'lemonsqueezy_response' }, 502);
    }
    return c.json({ ok: true, url });
  } catch (err) {
    console.error('[license] customer-portal network error:', err);
    return c.json({ ok: false, error: 'network' }, 502);
  }
});

// Creates an LS checkout session for the authenticated user, with
// custom_data.user_id baked in so the resulting subscription's
// webhook events can be linked back to our user row even before
// LS's customer email matches.
//
// Returns { ok: true, url } — the desktop app opens that URL in the
// user's default browser via shell.openExternal.
licenseRoutes.post('/checkout', async (c) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ ok: false, error: 'unauthenticated' }, 401);
  const user = await userFromSession(c.env, token);
  if (!user) return c.json({ ok: false, error: 'unauthenticated' }, 401);

  const body = await c.req.json<{ plan?: 'monthly' | 'yearly' }>().catch(() => ({} as { plan?: 'monthly' | 'yearly' }));
  const plan = body.plan;
  const variantId =
    plan === 'yearly'
      ? c.env.LEMONSQUEEZY_VARIANT_YEARLY
      : plan === 'monthly'
        ? c.env.LEMONSQUEEZY_VARIANT_MONTHLY
        : null;
  if (!variantId) return c.json({ ok: false, error: 'invalid_plan' }, 400);

  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: lsHeaders(c.env.LEMONSQUEEZY_API_KEY),
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: user.email,
              custom: { user_id: user.id },
            },
            // Test mode is determined by the variant being a test-mode
            // variant in LS. Setting it here is belt-and-braces.
            test_mode: c.env.LEMONSQUEEZY_TEST_MODE === 'true',
            // Auto-close the LS success screen after a moment, since
            // we're going to bring the user back to the app via
            // re-verify on focus rather than a redirect.
            checkout_options: { embed: false },
          },
          relationships: {
            store: {
              data: { type: 'stores', id: c.env.LEMONSQUEEZY_STORE_ID },
            },
            variant: {
              data: { type: 'variants', id: variantId },
            },
          },
        },
      }),
    });
    const responseBody = (await res.json().catch(() => ({}))) as {
      data?: { attributes?: { url?: string } };
      errors?: unknown;
    };
    if (!res.ok) {
      console.error('[license] LS checkout create failed:', JSON.stringify(responseBody, null, 2));
      return c.json({ ok: false, error: 'lemonsqueezy_error' }, 502);
    }
    const url = responseBody.data?.attributes?.url;
    if (!url) {
      console.error('[license] LS checkout response missing url:', responseBody);
      return c.json({ ok: false, error: 'lemonsqueezy_response' }, 502);
    }
    return c.json({ ok: true, url });
  } catch (err) {
    console.error('[license] checkout network error:', err);
    return c.json({ ok: false, error: 'network' }, 502);
  }
});

// Admin-only fallback for missed webhooks. Takes a ?email= query
// param, looks up the matching user's subscription via the LS API
// (filtered by user_email), and upserts the row into D1 by reusing
// the same path the webhook handler takes. Use it when a real
// purchase landed but the webhook didn't deliver (no live endpoint
// configured at the time, secret mismatch, etc.).
//
// Authed by an ADMIN_TOKEN secret rather than user session, so
// you can run it from your laptop without impersonating the user.
licenseRoutes.post('/admin-sync', async (c) => {
  const provided = bearer(c.req.header('Authorization'));
  if (!provided || !c.env.ADMIN_TOKEN || provided !== c.env.ADMIN_TOKEN) {
    return c.json({ ok: false, error: 'unauthenticated' }, 401);
  }
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email) return c.json({ ok: false, error: 'missing_email' }, 400);

  const user = await c.env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`,
  ).bind(email).first<{ id: string }>();
  if (!user) return c.json({ ok: false, error: 'user_not_found' }, 404);

  // Ask LS for any subscriptions belonging to that email. Filter is
  // documented at https://docs.lemonsqueezy.com/api/subscriptions.
  const url = `https://api.lemonsqueezy.com/v1/subscriptions?filter%5Buser_email%5D=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: lsHeaders(c.env.LEMONSQUEEZY_API_KEY) });
  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id: string; attributes?: LSSubscriptionAttributes }>;
    errors?: unknown;
  };
  if (!res.ok) {
    console.error('[license:admin-sync] LS list failed:', JSON.stringify(body, null, 2));
    return c.json({ ok: false, error: 'lemonsqueezy_error' }, 502);
  }
  const subs = body.data || [];
  if (!subs.length) {
    return c.json({ ok: true, synced: 0, note: 'no subscriptions found in LS for this email' });
  }

  let synced = 0;
  for (const s of subs) {
    if (!s?.attributes) continue;
    // Make sure the user is linked to the LS customer before
    // upsertSubscription runs — upsert looks up the user by
    // customer_id.
    if (s.attributes.customer_id) {
      await linkCustomerToUser(c.env, user.id, String(s.attributes.customer_id));
    }
    await upsertSubscription(c.env, s.id, s.attributes);
    synced += 1;
  }
  return c.json({ ok: true, synced });
});

// Admin-only: who is currently NOT entitled despite having bought
// something? This is the "who did we hurt" report — run it after any
// change to entitlement logic, and periodically as a watchdog.
//
// Lists every user who has at least one subscription row but would be
// answered `entitled: false` by /license/verify right now. Each entry
// carries a `suspicious` flag: the user has a paid plan on record, yet
// no subscription of theirs has a period end in the past. That
// combination means we can't point at a date and say "this is when
// their access legitimately ran out" — the shape of a wrongful
// downgrade, as opposed to an ordinary lapsed subscription.
//
// Anything with suspicious: true wants a POST /license/admin-sync
// ?email=… to re-pull the truth from Lemon Squeezy.
licenseRoutes.get('/admin-audit', async (c) => {
  const provided = bearer(c.req.header('Authorization'));
  if (!provided || !c.env.ADMIN_TOKEN || provided !== c.env.ADMIN_TOKEN) {
    return c.json({ ok: false, error: 'unauthenticated' }, 401);
  }

  const now = Date.now();
  const rowsResult = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.lemonsqueezy_subscription_id, s.status, s.plan,
            s.current_period_start, s.current_period_end,
            s.cancel_at_period_end, s.canceled_at, s.created_at, s.updated_at,
            u.email AS email
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
      ORDER BY s.user_id, s.updated_at DESC`,
  ).all<SubscriptionRow & { email: string }>();
  const rows = rowsResult.results ?? [];

  const byUser = new Map<string, Array<SubscriptionRow & { email: string }>>();
  for (const r of rows) {
    const list = byUser.get(r.user_id);
    if (list) list.push(r);
    else byUser.set(r.user_id, [r]);
  }

  const report = [];
  for (const [userId, subs] of byUser) {
    const entitled = subs.some((r) => rowEntitles(r, now));
    if (entitled) continue;
    const everPaid = subs.some((r) => r.plan != null);
    // A legitimate lapse has a period end in the past to point at.
    const hasElapsedPeriod = subs.some(
      (r) => r.current_period_end != null && r.current_period_end <= now,
    );
    report.push({
      user_id: userId,
      email: subs[0]?.email ?? null,
      suspicious: everPaid && !hasElapsedPeriod,
      subscriptions: subs.map((r) => ({
        lemonsqueezy_subscription_id: r.lemonsqueezy_subscription_id,
        status: r.status,
        plan: r.plan,
        current_period_end: r.current_period_end,
        cancel_at_period_end: r.cancel_at_period_end === 1,
        updated_at: r.updated_at,
      })),
    });
  }

  report.sort((a, b) => Number(b.suspicious) - Number(a.suspicious));
  return c.json({
    ok: true,
    checked_at: now,
    users_with_subscriptions: byUser.size,
    unentitled: report.length,
    suspicious: report.filter((r) => r.suspicious).length,
    report,
  });
});

// Admin-only: extend a user's paid access to an explicit date.
//
// The last-resort remediation, for when Lemon Squeezy can no longer
// tell us the truth — the subscription was refunded away, deleted, or
// the user's access was wrongly revoked long enough ago that goodwill
// is owed on top. Prefer /license/admin-sync first; that re-derives
// state from LS and is self-correcting. Reach for this only when a
// sync can't produce the right answer.
//
// POST /license/admin-grant?email=…&until=2027-01-01  (or until=<ms>)
// Optional &plan=monthly|yearly for display.
//
// Writes a subscription row with no lemonsqueezy_subscription_id so a
// later real webhook can never collide with or clobber it.
licenseRoutes.post('/admin-grant', async (c) => {
  const provided = bearer(c.req.header('Authorization'));
  if (!provided || !c.env.ADMIN_TOKEN || provided !== c.env.ADMIN_TOKEN) {
    return c.json({ ok: false, error: 'unauthenticated' }, 401);
  }
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email) return c.json({ ok: false, error: 'missing_email' }, 400);

  const rawUntil = (c.req.query('until') || '').trim();
  if (!rawUntil) return c.json({ ok: false, error: 'missing_until' }, 400);
  const until = /^\d+$/.test(rawUntil) ? Number(rawUntil) : Date.parse(rawUntil);
  if (!Number.isFinite(until)) return c.json({ ok: false, error: 'invalid_until' }, 400);
  if (until <= Date.now()) return c.json({ ok: false, error: 'until_in_past' }, 400);

  const planParam = c.req.query('plan');
  const plan = planParam === 'monthly' || planParam === 'yearly' ? planParam : null;

  const user = await c.env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`,
  ).bind(email).first<{ id: string }>();
  if (!user) return c.json({ ok: false, error: 'user_not_found' }, 404);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO subscriptions
       (id, user_id, lemonsqueezy_subscription_id, status, plan,
        current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, created_at, updated_at)
     VALUES (?, ?, NULL, 'active', ?, ?, ?, 0, NULL, ?, ?)`,
  )
    .bind(crypto.randomUUID(), user.id, plan, now, until, now, now)
    .run();

  return c.json({ ok: true, user_id: user.id, email, entitled_until: until, plan });
});

function lsHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
}
