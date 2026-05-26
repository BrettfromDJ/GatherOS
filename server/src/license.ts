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

export const licenseRoutes = new Hono<{ Bindings: Env }>();

const ENTITLED_SUB_STATUSES = new Set<SubscriptionRow['status']>([
  'active',
  'past_due', // grace window — LS dunning will eventually flip to canceled
  'trialing',
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
    `SELECT id, user_id, lemonsqueezy_subscription_id, status, plan,
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

  const body = await c.req.json<{ plan?: 'monthly' | 'yearly' }>().catch(() => ({}));
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

function lsHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
}
