// Entitlement truth table.
//
// Run with: npm test  (node:test + --experimental-strip-types)
//
// This exists because entitlement has been wrong twice in ways that
// cost real customers real access:
//
//   1. Payment (invoice) webhooks minted bogus subscription rows that
//      then outranked the real one — fixed by isSubscriptionUpsertEvent.
//   2. A Lemon Squeezy `cancelled` status was read as "not a customer",
//      so a yearly subscriber who cancelled in week one was downgraded
//      to free on the spot instead of keeping the year they'd bought.
//
// Both were single-line judgements about a status string. Pin them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { rowEntitles, isSubscriptionUpsertEvent, derivePeriodEnd } from './rules.ts';
import type { SubscriptionRow } from './types.ts';

const NOW = Date.UTC(2026, 7, 20);
const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

function row(over: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    id: 'sub-row',
    user_id: 'user-1',
    lemonsqueezy_subscription_id: 'ls-1',
    status: 'active',
    plan: 'yearly',
    current_period_start: NOW - DAY,
    current_period_end: NOW + YEAR,
    cancel_at_period_end: 0,
    canceled_at: null,
    created_at: NOW - DAY,
    updated_at: NOW,
    ...over,
  };
}

test('active subscription entitles', () => {
  assert.equal(rowEntitles(row({ status: 'active' }), NOW), true);
});

test('trialing subscription entitles', () => {
  assert.equal(rowEntitles(row({ status: 'trialing' }), NOW), true);
});

test('past_due entitles — dunning grace, not a cutoff', () => {
  assert.equal(rowEntitles(row({ status: 'past_due' }), NOW), true);
});

// The regression this file was written for.
test('yearly subscriber who cancels on day 2 keeps the year', () => {
  const justCancelled = row({
    status: 'canceled',
    cancel_at_period_end: 1,
    current_period_end: NOW + YEAR - 2 * DAY,
  });
  assert.equal(rowEntitles(justCancelled, NOW), true);
});

test('monthly subscriber who cancels mid-cycle keeps the rest of the month', () => {
  const justCancelled = row({
    status: 'canceled',
    plan: 'monthly',
    cancel_at_period_end: 1,
    current_period_end: NOW + 12 * DAY,
  });
  assert.equal(rowEntitles(justCancelled, NOW), true);
});

test('cancelled subscription stops entitling once the paid period elapses', () => {
  const done = row({
    status: 'canceled',
    cancel_at_period_end: 0,
    current_period_end: NOW - DAY,
  });
  assert.equal(rowEntitles(done, NOW), false);
});

test('expired subscription does not entitle', () => {
  const done = row({ status: 'expired', current_period_end: NOW - YEAR });
  assert.equal(rowEntitles(done, NOW), false);
});

test('paused subscription keeps a period already paid for', () => {
  assert.equal(rowEntitles(row({ status: 'paused' }), NOW), true);
});

test('a row with no period end and a dead status does not entitle', () => {
  const unknown = row({ status: 'expired', current_period_end: null });
  assert.equal(rowEntitles(unknown, NOW), false);
});

test('the boundary is exclusive — access ends exactly at period end', () => {
  assert.equal(rowEntitles(row({ status: 'canceled', current_period_end: NOW }), NOW), false);
  assert.equal(rowEntitles(row({ status: 'canceled', current_period_end: NOW + 1 }), NOW), true);
});

// derivePeriodEnd — which LS date wins, and why.
test('a live subscription takes its period end from renews_at', () => {
  assert.equal(
    derivePeriodEnd('2027-08-20T00:00:00.000000Z', null),
    Date.UTC(2027, 7, 20),
  );
});

test('a scheduled cancellation takes its period end from ends_at', () => {
  assert.equal(
    derivePeriodEnd(null, '2027-08-20T00:00:00.000000Z'),
    Date.UTC(2027, 7, 20),
  );
});

// The refund / chargeback case: ends_at says access stops now, while
// renews_at may still hold the date it *would* have renewed. Taking the
// later of the two would keep a refunded customer entitled for a year.
test('ends_at wins over a stale future renews_at', () => {
  assert.equal(
    derivePeriodEnd('2027-08-20T00:00:00.000000Z', '2026-08-20T00:00:00.000000Z'),
    Date.UTC(2026, 7, 20),
  );
});

test('no usable date yields null, so the stored value is left alone', () => {
  assert.equal(derivePeriodEnd(null, null), null);
  assert.equal(derivePeriodEnd(undefined, undefined), null);
  assert.equal(derivePeriodEnd('not a date', null), null);
});

// Guarding regression #1 — payment events carry invoice-shaped data and
// must never mint or update a subscription row.
test('payment webhooks are not subscription upserts', () => {
  for (const evt of [
    'subscription_payment_success',
    'subscription_payment_failed',
    'subscription_payment_recovered',
    'order_created',
  ]) {
    assert.equal(isSubscriptionUpsertEvent(evt, 'subscription-invoices'), false, evt);
    assert.equal(isSubscriptionUpsertEvent(evt, 'subscriptions'), false, evt);
  }
});

test('genuine subscription webhooks are upserts', () => {
  for (const evt of [
    'subscription_created',
    'subscription_updated',
    'subscription_cancelled',
    'subscription_resumed',
    'subscription_expired',
    'subscription_paused',
    'subscription_unpaused',
  ]) {
    assert.equal(isSubscriptionUpsertEvent(evt, 'subscriptions'), true, evt);
    // …but never when the payload is actually an invoice.
    assert.equal(isSubscriptionUpsertEvent(evt, 'subscription-invoices'), false, evt);
  }
});
