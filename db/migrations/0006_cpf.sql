-- Conditional probability function: which direction the dirty hours come from.
--
-- One row per (city, source). The hourly series it is computed from are not stored — they are
-- ~750 values per city per month and the answer is five numbers, so keeping the working is a
-- hundred times the size of the result and nothing reads it.
CREATE TABLE IF NOT EXISTS cpf (
  city_id     INTEGER NOT NULL REFERENCES cities (id),
  source_id   INTEGER NOT NULL REFERENCES sources (id),
  -- Share of hours with wind from this source that were in the city's dirtiest quartile. 0-1.
  score       REAL    NOT NULL,
  bearing_deg REAL    NOT NULL,
  hours       INTEGER NOT NULL,          -- hours the wind blew from it at all
  high_hours  INTEGER NOT NULL,
  -- The sentence this exists to support: "when the wind is off the works you breathe 31, otherwise 12"
  pm25_from   REAL,
  pm25_other  REAL,
  period      TEXT,                      -- 'YYYY-MM', the month the series covered
  PRIMARY KEY (city_id, source_id)
);
CREATE INDEX IF NOT EXISTS cpf_city ON cpf (city_id, score DESC);
