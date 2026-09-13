CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_hash text NOT NULL,
  editor_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_sessions (
  hash text PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor')),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS dialogues (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id uuid PRIMARY KEY,
  dialogue_id uuid NOT NULL REFERENCES dialogues(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('start', 'line', 'choice', 'end')),
  x double precision NOT NULL,
  y double precision NOT NULL,
  preview text NOT NULL DEFAULT '',
  text_state bytea,
  text_revision bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_start ON nodes(dialogue_id) WHERE kind = 'start';
CREATE INDEX IF NOT EXISTS dialogue_nodes ON nodes(dialogue_id);
CREATE TABLE IF NOT EXISTS text_operations (
  node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  payload_hash text NOT NULL,
  update_data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, operation_id)
);
