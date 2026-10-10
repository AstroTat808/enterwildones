-- Event-scoped, transactionally locked admission inventory.
-- Apply after 001 and 002 on a Neon branch; only then apply to production.
CREATE TABLE IF NOT EXISTS wildones_event_capacity (
  event_id TEXT PRIMARY KEY,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wildones_admission_reservations (
  event_id TEXT NOT NULL REFERENCES wildones_event_capacity(event_id),
  invitation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('held','issued','released')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, invitation_id)
);

-- Prevent separate invitations from reserving multiple seats for one account.
CREATE UNIQUE INDEX IF NOT EXISTS wildones_unique_live_admission_per_user
  ON wildones_admission_reservations(event_id, user_id)
  WHERE status IN ('held','issued');
CREATE INDEX IF NOT EXISTS wildones_admission_reservations_by_event_status
  ON wildones_admission_reservations(event_id, status);
