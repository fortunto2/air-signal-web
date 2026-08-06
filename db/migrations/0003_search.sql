-- The search box queries `cities.name` on every keystroke, and there was no index on it: a prefix
-- match scanned all 10 596 rows. `NOCASE` because a reader types "sofia" and the row says "Sofia" —
-- without it, LIKE's built-in case-insensitivity cannot use the index at all and the index is
-- decoration.
CREATE INDEX IF NOT EXISTS cities_name ON cities (name COLLATE NOCASE);
