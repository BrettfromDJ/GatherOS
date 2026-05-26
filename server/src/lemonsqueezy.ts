// Lemon Squeezy webhook handler.
//
// LS posts events to /webhooks/lemonsqueezy with HMAC-SHA256 of the
// raw body in the X-Signature header (hex-encoded), verified using
// the signing secret we configured in the LS dashboard.
//
// LS event names we care about (see https://docs.lemonsqueezy.com/api/webhooks):
//   subscription_created
//   subscription_updated
//   subscription_cancelled       (scheduled — still active until ends_at)
//   subscription_resumed         (un-cancelled)
//   subscription_expired         (final — access ends now)
//   subscription_paused
//   subscription_unpaused
//   subscription_payment_failed
//   subscription_payment_success
//   subscription_payment_recovered
//
// Customer linking uses meta.custom_data.user_id, which the desktop
// app's checkout-creation flow stuffs in there. Same self-healing
// idea as the Paddle implementation: every event with both a user_id
// and customer_id sets paddle_customer_id… er, lemonsqueezy_customer_id
// on the user row, so out-of-order delivery resolves on the next event.

import { Hono } from 'hono';
import type { Env, SubscriptionRow } from './types';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

webhookRoutes.post('/lemonsqueezy', async (c) => {
  const sigHeader = c.req.header('X-Signature') || '';
  const eventName = c.req.header('X-Event-Name') || '';
  const rawBody = await c.req.text();

  if (!(await verifyLemonSqueezySignature(sigHeader, rawBody, c.env.LEMONSQUEEZY_WEBHOOK_SECRET))) {
    return c.json({ ok: false, error: 'bad_signature' }, 401);
  }

  let evt: LSEvent;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  // LS puts the event name in both the header and meta.event_name. We
  // prefer the body since the header isn't part of the signed payload
  // and could (in theory) be lied about.
  const resolvedEventName = evt.meta?.event_name || eventName;

  try {
    await handleEvent(c.env, resolvedEventName, evt);
  } catch (err) {
    console.error('[lemonsqueezy] handler failed:', err, 'event:', resolvedEventName);
    // Return 200 so LS doesn't retry — we logged the error and a
    // future event for the same subscription will reconcile state.
    return c.json({ ok: true, warned: true });
  }
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────

async function verifyLemonSqueezySignature(
  signature: string,
  body: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret || secret === 'stub') {
    return secret === 'stub';
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const computed = bufferToHex(sig);
  return constantTimeEqual(computed, signature);
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─────────────────────────────────────────────────────────────────
// Event dispatch
// ─────────────────────────────────────────────────────────────────

interface LSEvent {
  meta?: {
    event_name?: string;
    custom_data?: { user_id?: string } | null;
  };
  data?: {
    type?: string;
    id?: string;
    attributes?: LSSubscriptionAttributes;
  };
}

export interface LSSubscriptionAttributes {
  store_id?: number;
  customer_id?: number;
  order_id?: number;
  product_id?: number;
  variant_id?: number;
  product_name?: string;
  variant_name?: string;
  user_email?: string;
  status?: string;
  card_brand?: string;
  card_last_four?: string;
  trial_ends_at?: string | null;
  renews_at?: string | null;
  ends_at?: string | null;
  cancelled?: boolean;
  created_at?: string;
  updated_at?: string;
  test_mode?: boolean;
}

async function handleEvent(env: Env, eventName: string, evt: LSEvent): Promise<void> {
  // Opportunistically link the LS customer to our user row using
  // meta.custom_data.user_id. The desktop app's create-checkout flow
  // stamps this in. Linking on every event self-heals against
  // out-of-order delivery.
  const userId = evt.meta?.custom_data?.user_id;
  const customerId = evt.data?.attributes?.customer_id
    ? String(evt.data.attributes.customer_id)
    : undefined;
  if (userId && customerId) {
    await linkCustomerToUser(env, userId, customerId);
  }

  if (
    eventName === 'subscription_created' ||
    eventName === 'subscription_updated' ||
    eventName === 'subscription_cancelled' ||
    eventName === 'subscription_resumed' ||
    eventName === 'subscription_expired' ||
    eventName === 'subscription_paused' ||
    eventName === 'subscription_unpaused' ||
    eventName === 'subscription_payment_success' ||
    eventName === 'subscription_payment_failed' ||
    eventName === 'subscription_payment_recovered'
  ) {
    if (evt.data?.id && evt.data.attributes) {
      await upsertSubscription(env, evt.data.id, evt.data.attributes);
    }
    return;
  }
  // Other events (order_created, etc.) are fine to ignore for now.
}

export async function linkCustomerToUser(
  env: Env,
  userId: string,
  customerId: string,
): Promise<void> {
  // Set lemonsqueezy_customer_id only if it's still null OR already
  // equals this same id. Refusing to overwrite a different existing
  // id avoids stomping on a user who switched accounts.
  await env.DB.prepare(
    `UPDATE users
        SET lemonsqueezy_customer_id = ?
      WHERE id = ?
        AND (lemonsqueezy_customer_id IS NULL OR lemonsqueezy_customer_id = ?)`,
  )
    .bind(customerId, userId, customerId)
    .run();
}

// LS status values → our internal SubscriptionStatus.
//
// LS:           ours:
//   on_trial → trialing
//   active   → active
//   past_due → past_due
//   unpaid   → past_due  (similar dunning state, no need for a separate slot)
//   paused   → paused
//   cancelled → canceled (note the two-l British spelling on LS's side)
//   expired  → canceled  (final)
function mapStatus(s?: string): SubscriptionRow['status'] {
  switch (s) {
    case 'on_trial': return 'trialing';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'past_due';
    case 'paused': return 'paused';
    case 'cancelled':
    case 'expired':
      return 'canceled';
    default:
      return 'active';
  }
}

export async function upsertSubscription(
  env: Env,
  lsSubscriptionId: string,
  d: LSSubscriptionAttributes,
): Promise<void> {
  const status = mapStatus(d.status);
  const customerId = d.customer_id ? String(d.customer_id) : null;
  // Plan is derived from variant_id — we read the configured ids from
  // env so we don't have to redeploy when prices change in LS.
  let plan: SubscriptionRow['plan'] = null;
  if (d.variant_id != null) {
    if (String(d.variant_id) === env.LEMONSQUEEZY_VARIANT_MONTHLY) plan = 'monthly';
    else if (String(d.variant_id) === env.LEMONSQUEEZY_VARIANT_YEARLY) plan = 'yearly';
  }
  const periodEnd = parseTs(d.renews_at) ?? parseTs(d.ends_at);
  // LS doesn't expose an explicit period_start. The previous
  // updated_at is a reasonable proxy; we only use this for display.
  const periodStart = parseTs(d.updated_at);
  const canceledAt = parseTs(d.ends_at);
  // 'cancelled' status with ends_at in the future = scheduled cancel.
  // 'cancelled' with ends_at in the past = already ended.
  const cancelAtPeriodEnd = d.cancelled && periodEnd && periodEnd > Date.now() ? 1 : 0;

  if (!customerId) return;
  const user = await env.DB.prepare(
    `SELECT id FROM users WHERE lemonsqueezy_customer_id = ?`,
  )
    .bind(customerId)
    .first<{ id: string }>();
  if (!user) {
    console.warn('[lemonsqueezy] unknown customer, dropping event:', customerId);
    return;
  }

  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM subscriptions WHERE lemonsqueezy_subscription_id = ?`,
  )
    .bind(lsSubscriptionId)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE subscriptions
          SET status = ?, plan = ?, current_period_start = ?,
              current_period_end = ?, cancel_at_period_end = ?,
              canceled_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        status,
        plan,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd,
        canceledAt,
        now,
        existing.id,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO subscriptions
         (id, user_id, lemonsqueezy_subscription_id, status, plan,
          current_period_start, current_period_end,
          cancel_at_period_end, canceled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        lsSubscriptionId,
        status,
        plan,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd,
        canceledAt,
        now,
        now,
      )
      .run();
  }
}

function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
