-- GatherOS licensing database — initial schema.
--
-- Four tables:
--   users          one row per signup; carries trial_ends_at + paddle_customer_id
--   magic_links    short-lived single-use email tokens
--   sessions       opaque tokens issued after magic-link verify (one per device)
--   subscriptions  Paddle source-of-truth mirror, joined to users by paddle_customer_id

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  created_at          INTEGER NOT NULL,
  trial_ends_at       INTEGER NOT NULL,
  paddle_customer_id  TEXT,
  -- Soft-delete flag. We keep the row so a returning user gets the
  -- same id (and their old subscription history) on re-signup.
  deleted_at          INTEGER
);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_paddle_customer ON users (paddle_customer_id);

CREATE TABLE magic_links (
  token         TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  -- Optional context — purely for debugging / abuse signals later.
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_magic_links_email ON magic_links (email);
CREATE INDEX idx_magic_links_expires ON magic_links (expires_at);

CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label   TEXT,
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  revoked_at     INTEGER
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE subscriptions (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paddle_subscription_id   TEXT UNIQUE,
  -- Status values mirror what Paddle Billing emits:
  --   active | past_due | paused | canceled | trialing
  -- We also use a synthetic 'inactive' downstream for "no row at all".
  status                   TEXT NOT NULL,
  plan                     TEXT,           -- 'monthly' | 'yearly'
  current_period_start     INTEGER,
  current_period_end       INTEGER,
  cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
  canceled_at              INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
CREATE INDEX idx_subscriptions_user ON subscriptions (user_id);
