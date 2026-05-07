// Paddle webhook handler.
//
// Paddle Billing posts events to our endpoint with a signature in
// the `Paddle-Signature` header of the form `ts=<unix>;h1=<hmac>`.
// We HMAC-SHA256 of `<ts>:<rawBody>` with the webhook secret and
// compare against `h1` in constant time.
//
// Events we care about (see https://developer.paddle.com/webhooks):
//   subscription.created
//   subscription.activated
//   subscription.updated
//   subscription.canceled
//   subscription.paused
//   transaction.completed   (used to attach paddle_customer_id on
//                            first checkout if we don't have it yet)
//
// All sub events carry a `data` object with: id, status, customer_id,
// items[].price.id, current_billing_period.{starts_at, ends_at},
// scheduled_change.{action,effective_at,resume_at}, canceled_at.

import { Hono } from 'hono';
import type { Env, SubscriptionRow } from './types';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

webhookRoutes.post('/paddle', async (c) => {
  const sigHeader = c.req.header('Paddle-Signature') || '';
  const rawBody = await c.req.text();

  if (!(await verifyPaddleSignature(sigHeader, rawBody, c.env.PADDLE_WEBHOOK_SECRET))) {
    return c.json({ ok: false, error: 'bad_signature' }, 401);
  }

  let evt: PaddleEvent;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  try {
    await handleEvent(c.env, evt);
  } catch (err) {
    console.error('[paddle] handler failed:', err, 'event:', evt.event_type);
    // Return 200 anyway — non-2xx triggers Paddle's retry, which is
    // good for transient failures but a foot-gun for poisoned events.
    // We log + alert, then ack. Keep this until we add a retry queue.
    return c.json({ ok: true, warned: true });
  }
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// Signature verification (Paddle Billing — https://developer.paddle.com/webhooks/signature-verification)
// ─────────────────────────────────────────────────────────────────

async function verifyPaddleSignature(
  header: string,
  body: string,
  secret: string,
): Promise<boolean> {
  if (!header || !secret || secret === 'stub') {
    // In dev with stub secret, accept anything so you can curl events
    // through. Don't deploy with PADDLE_WEBHOOK_SECRET=stub.
    return secret === 'stub';
  }
  const parts = Object.fromEntries(
    header.split(';').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim() || '', v?.trim() || ''];
    }),
  ) as Record<string, string>;
  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`));
  const computed = bufferToHex(sig);
  return constantTimeEqual(computed, h1);
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

interface PaddleEvent {
  event_type: string;
  data: PaddleSubscriptionData & PaddleTransactionData;
}

interface PaddleSubscriptionData {
  id?: string;
  status?: SubscriptionRow['status'];
  customer_id?: string;
  custom_data?: { user_id?: string } | null;
  items?: Array<{ price?: { id?: string; product_id?: string; billing_cycle?: { interval?: 'month' | 'year' } } }>;
  current_billing_period?: { starts_at?: string; ends_at?: string };
  scheduled_change?: { action?: string; effective_at?: string } | null;
  canceled_at?: string | null;
}

interface PaddleTransactionData {
  customer_id?: string;
  subscription_id?: string;
  custom_data?: { user_id?: string } | null;
}

async function handleEvent(env: Env, evt: PaddleEvent): Promise<void> {
  // Opportunistically link the Paddle customer to our user row using
  // custom_data.user_id, which the desktop app sets at Checkout.open
  // time. Doing this on every event self-heals — even if events arrive
  // out of order, the first one with custom_data wins, and subsequent
  // events find the user.
  const userId = evt.data.custom_data?.user_id;
  const customerId = evt.data.customer_id;
  if (userId && customerId) {
    await linkCustomerToUser(env, userId, customerId);
  }

  if (evt.event_type.startsWith('subscription.')) {
    await upsertSubscription(env, evt.data);
    return;
  }
  // transaction.completed is fully handled by the link step above —
  // we don't persist transaction rows in Phase 1.
}

async function linkCustomerToUser(
  env: Env,
  userId: string,
  customerId: string,
): Promise<void> {
  // Set paddle_customer_id only if it's still null OR already equals
  // this same id. Refusing to overwrite a different existing id avoids
  // stomping on a user who switched accounts.
  await env.DB.prepare(
    `UPDATE users
        SET paddle_customer_id = ?
      WHERE id = ?
        AND (paddle_customer_id IS NULL OR paddle_customer_id = ?)`,
  )
    .bind(customerId, userId, customerId)
    .run();
}

async function upsertSubscription(env: Env, d: PaddleSubscriptionData): Promise<void> {
  if (!d.id) throw new Error('subscription event missing data.id');
  const status = (d.status || 'active') as SubscriptionRow['status'];
  const customerId = d.customer_id || null;
  const interval = d.items?.[0]?.price?.billing_cycle?.interval;
  const plan: SubscriptionRow['plan'] =
    interval === 'year' ? 'yearly' : interval === 'month' ? 'monthly' : null;
  const periodStart = parseTs(d.current_billing_period?.starts_at);
  const periodEnd = parseTs(d.current_billing_period?.ends_at);
  const canceledAt = parseTs(d.canceled_at);
  const cancelAtPeriodEnd =
    d.scheduled_change?.action === 'cancel' ? 1 : 0;

  // Resolve the user from the customer id. If we don't know this
  // customer yet, drop the event — the user will get linked on
  // their next signin (we'll wire that up in Phase 3).
  if (!customerId) return;
  const user = await env.DB.prepare(
    `SELECT id FROM users WHERE paddle_customer_id = ?`,
  )
    .bind(customerId)
    .first<{ id: string }>();
  if (!user) {
    console.warn('[paddle] unknown customer, dropping event:', customerId);
    return;
  }

  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM subscriptions WHERE paddle_subscription_id = ?`,
  )
    .bind(d.id)
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
         (id, user_id, paddle_subscription_id, status, plan,
          current_period_start, current_period_end,
          cancel_at_period_end, canceled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        d.id,
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
