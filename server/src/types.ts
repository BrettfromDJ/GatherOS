// Worker bindings declared in wrangler.toml + secrets set via
// `wrangler secret put`. Hono uses this to type c.env.
export type Env = {
  DB: D1Database;

  // [vars]
  APP_NAME: string;
  TRIAL_DAYS: string;
  APP_DEEP_LINK_SCHEME: string;
  EMAIL_FROM: string;
  // 'true' = Lemon Squeezy test mode, 'false' = live mode. Affects
  // which API host the customer-portal + checkout endpoints hit.
  LEMONSQUEEZY_TEST_MODE: string;
  // Catalog ids — used to map an incoming subscription's variant_id
  // back to a 'monthly' | 'yearly' plan label.
  LEMONSQUEEZY_STORE_ID: string;
  LEMONSQUEEZY_VARIANT_MONTHLY: string;
  LEMONSQUEEZY_VARIANT_YEARLY: string;

  // Secrets (set via `wrangler secret put`)
  RESEND_API_KEY: string;
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  LEMONSQUEEZY_API_KEY: string;
};

// Row shapes — keep in sync with migrations/0001_initial.sql + later.
export interface UserRow {
  id: string;
  email: string;
  created_at: number;
  trial_ends_at: number;
  lemonsqueezy_customer_id: string | null;
  deleted_at: number | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  device_label: string | null;
  created_at: number;
  last_seen_at: number;
  revoked_at: number | null;
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  lemonsqueezy_subscription_id: string | null;
  status: SubscriptionStatus;
  plan: 'monthly' | 'yearly' | null;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
  canceled_at: number | null;
  created_at: number;
  updated_at: number;
}
