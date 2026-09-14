ALTER TABLE characters ADD COLUMN IF NOT EXISTS color text;
WITH palette AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY id) - 1 AS position
  FROM characters
)
UPDATE characters c
SET color = (ARRAY['#4c956c','#487fbd','#b45f8c','#c18a35','#8065b1','#3d989d','#bc654d','#727f3a'])[(p.position % 8)::int + 1]
FROM palette p WHERE c.id=p.id AND c.color IS NULL;
ALTER TABLE characters ALTER COLUMN color SET DEFAULT '#4c956c';
ALTER TABLE characters ALTER COLUMN color SET NOT NULL;
