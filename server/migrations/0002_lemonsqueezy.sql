-- Switch from Paddle to Lemon Squeezy as the payment provider.
-- Schema is the same shape; just rename the provider-specific columns.
--
-- For local-mode D1: this is destructive on column-name drops, so any
-- in-flight test data referencing the old column will be reset. We're
-- pre-launch so that's fine.

ALTER TABLE users
  RENAME COLUMN paddle_customer_id TO lemonsqueezy_customer_id;

DROP INDEX IF EXISTS idx_users_paddle_customer;
CREATE INDEX idx_users_lemonsqueezy_customer ON users (lemonsqueezy_customer_id);

ALTER TABLE subscriptions
  RENAME COLUMN paddle_subscription_id TO lemonsqueezy_subscription_id;
