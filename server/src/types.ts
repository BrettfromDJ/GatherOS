// Worker bindings declared in wrangler.toml + secrets set via
// `wrangler secret put`. Hono uses this to type c.env.
export type Env = {
  DB: D1Database;

  // [vars]
  APP_NAME: string;
  TRIAL_DAYS: string;
  APP_DEEP_LINK_SCHEME: string;
  EMAIL_FROM: string;
  PADDLE_ENV: 'sandbox' | 'production';

  // Secrets (set via `wrangler secret put`)
  RESEND_API_KEY: string;
  PADDLE_WEBHOOK_SECRET: string;
  PADDLE_API_KEY: string;
};

// Row shapes — keep in sync with migrations/0001_initial.sql.
export interface UserRow {
  id: string;
  email: string;
  created_at: number;
  trial_ends_at: number;
  paddle_customer_id: string | null;
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
  paddle_subscription_id: string | null;
  status: SubscriptionStatus;
  plan: 'monthly' | 'yearly' | null;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
  canceled_at: number | null;
  created_at: number;
  updated_at: number;
}
