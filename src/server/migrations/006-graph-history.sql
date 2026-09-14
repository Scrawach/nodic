CREATE TABLE IF NOT EXISTS graph_history (
  dialogue_id uuid NOT NULL REFERENCES dialogues(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  actor text NOT NULL,
  changes jsonb NOT NULL,
  notice text NOT NULL DEFAULT '',
  PRIMARY KEY (dialogue_id, operation_id)
);
CREATE TABLE IF NOT EXISTS graph_field_versions (
  dialogue_id uuid NOT NULL REFERENCES dialogues(id) ON DELETE CASCADE,
  field text NOT NULL,
  version uuid,
  PRIMARY KEY (dialogue_id, field)
);

ALTER TABLE text_operations ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE text_operations ADD COLUMN IF NOT EXISTS revision bigint;
