CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL
);
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS character_id uuid REFERENCES characters(id) ON DELETE SET NULL;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS edges (
  id uuid PRIMARY KEY,
  dialogue_id uuid NOT NULL REFERENCES dialogues(id) ON DELETE CASCADE,
  source uuid NOT NULL REFERENCES nodes(id),
  target uuid NOT NULL REFERENCES nodes(id),
  bend_x double precision,
  bend_y double precision,
  UNIQUE (dialogue_id, source, target)
);
