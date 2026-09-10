CREATE TABLE IF NOT EXISTS wildones_passport_magic_links (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wildones_passport_magic_links_expiry_idx
  ON wildones_passport_magic_links (expires_at);
