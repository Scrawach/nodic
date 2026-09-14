CREATE TABLE IF NOT EXISTS creation_operations (
  scope text NOT NULL,
  operation_id uuid NOT NULL,
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (scope, operation_id)
);
