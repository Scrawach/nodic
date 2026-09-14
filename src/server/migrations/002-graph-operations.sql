CREATE TABLE IF NOT EXISTS graph_operations (
  dialogue_id uuid NOT NULL REFERENCES dialogues(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  payload_hash text NOT NULL,
  PRIMARY KEY (dialogue_id, operation_id)
);
