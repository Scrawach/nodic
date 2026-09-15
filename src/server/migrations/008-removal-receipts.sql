-- Retain only the access proof until its original expiry, without a project FK:
-- offline authors must distinguish deletion from expired access after a cascade.
CREATE TABLE IF NOT EXISTS removal_receipts (
  session_hash text NOT NULL,
  project_id uuid NOT NULL,
  dialogue_id uuid NOT NULL,
  project_deleted boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (session_hash, project_id, dialogue_id)
);
