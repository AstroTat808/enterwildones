CREATE TABLE IF NOT EXISTS wildones_drink_ledgers (
  event_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credits_purchased INTEGER NOT NULL CHECK (credits_purchased > 0),
  credits_redeemed INTEGER NOT NULL DEFAULT 0 CHECK (credits_redeemed >= 0),
  credits_remaining INTEGER NOT NULL CHECK (credits_remaining >= 0),
  wristband_code TEXT,
  wristband_activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, ticket_id),
  CHECK (credits_redeemed + credits_remaining = credits_purchased)
);

CREATE TABLE IF NOT EXISTS wildones_drink_redemptions (
  redemption_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redemption_number INTEGER NOT NULL CHECK (redemption_number > 0),
  wristband_code TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, ticket_id, redemption_number),
  FOREIGN KEY (event_id, ticket_id)
    REFERENCES wildones_drink_ledgers(event_id, ticket_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS wildones_drink_redemptions_event_idx
  ON wildones_drink_redemptions(event_id, redeemed_at DESC);
