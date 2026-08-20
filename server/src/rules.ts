// Pure entitlement / webhook rules.
//
// Deliberately free of runtime imports (the SubscriptionRow import is
// type-only and erases at compile time) so it can be unit-tested
// directly with node:test — see license.test.ts. Everything in here is
// a decision that has cost customers access when it was wrong, so it
// gets to be testable without standing up a Worker.

import type { SubscriptionRow } from './types';

// Statuses that entitle on their own, regardless of dates.
export const ENTITLED_SUB_STATUSES = new Set<SubscriptionRow['status']>([
  'active',
  'past_due', // dunning grace — LS will flip to canceled if it never clears
  'trialing',
]);

// Does this one subscription row entitle the user right now?
//
// Status alone is NOT enough. Lemon Squeezy flips a subscription to
// `cancelled` the instant the customer cancels, and sets `ends_at` to
// the end of the period they already paid for. A yearly subscriber who
// cancels on day 2 is `cancelled` with almost twelve months of paid
// access left. Deciding on status alone downgraded them on the spot —
// they lost access to something they had paid for.
//
// So: a row entitles if its status says so, OR if the period the user
// bought hasn't elapsed yet. The second clause is what makes cancelling
// behave the way it does in every other subscription product — you keep
// what you paid for until it runs out, then you drop to free.
//
// This deliberately also covers `paused`. If someone paused a period
// they had already paid for, letting them keep it until it lapses is
// the forgiving reading, and forgiving is the right default here:
// wrongly downgrading a paying customer is far more damaging than
// granting a few extra entitled days.
export function rowEntitles(row: SubscriptionRow, now: number): boolean {
  if (ENTITLED_SUB_STATUSES.has(row.status)) return true;
  return row.current_period_end != null && row.current_period_end > now;
}

// When does the user's paid access run out?
//
// Takes the raw LS `renews_at` / `ends_at` strings and returns an epoch
// ms, or null when neither is usable. Precedence matters, because this
// is the value entitlement is decided from:
//
//   ends_at set    → authoritative. LS only populates it once the
//                    subscription has an end — a scheduled cancellation
//                    (end of the period already paid for) or an
//                    immediate termination (now). It must win over
//                    renews_at, which can still hold the date the
//                    subscription *would* have renewed; preferring the
//                    later of the two would keep a refunded or
//                    charged-back subscription entitled until that
//                    stale renewal date.
//   ends_at null   → the subscription is live; renews_at is the end of
//                    the period currently paid for.
export function derivePeriodEnd(
  renewsAt: string | null | undefined,
  endsAt: string | null | undefined,
): number | null {
  return endsAt ? parseTs(endsAt) : parseTs(renewsAt);
}

function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// LS events whose `data` is a subscription object (data.type ===
// 'subscriptions') and therefore carries subscription-shaped attributes
// we can upsert. Everything else — crucially the subscription_payment_*
// events — must NOT be fed to upsertSubscription.
const SUBSCRIPTION_EVENTS = new Set<string>([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
]);

// True only for events we should upsert a subscription row from. The
// `subscription-invoices` type guard is belt-and-braces: the payment
// events already fall outside SUBSCRIPTION_EVENTS, but if LS ever routes
// an invoice payload under a name we do handle, we still refuse to key a
// row off an invoice id.
export function isSubscriptionUpsertEvent(eventName: string, dataType?: string): boolean {
  return SUBSCRIPTION_EVENTS.has(eventName) && dataType !== 'subscription-invoices';
}
