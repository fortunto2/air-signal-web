-- Air Signal — D1 schema.
--
-- Two rules govern everything here, and both come from a failure this project has already seen:
--
-- 1. The ETL only ever upserts. A bad minute at an upstream must age a row, never delete it —
--    otherwise one flaky fetch quietly takes a few thousand pages off the site, and nobody
--    notices until the traffic does. `last_seen` is how a station goes quiet; there is no DELETE.
--
-- 2. Absent is not zero. A signal we could not read is NULL, not 0. Zero is a measurement, and a
--    renderer that cannot tell them apart draws a full-height red bar for a sensor that does not
--    exist.

-- ---------------------------------------------------------------------------
-- cities — the place list. Seeded once from airq-core's embedded database.
-- ---------------------------------------------------------------------------
--
-- 10 596 cities across 156 countries, capped at 100 per country and ordered by population
-- descending. There is no population column in the source, so `rank` (position within the
-- country) is the population proxy the PRD's "top-N by population" gate actually gets.

CREATE TABLE IF NOT EXISTS cities (
  id            INTEGER PRIMARY KEY,
  country       TEXT    NOT NULL,          -- 'Turkey' — the source's own spelling
  country_slug  TEXT    NOT NULL,          -- 'turkey'
  slug          TEXT    NOT NULL,          -- 'alanya'
  name          TEXT    NOT NULL,          -- 'Alanya'
  lat           REAL    NOT NULL,
  lon           REAL    NOT NULL,
  rank          INTEGER NOT NULL,          -- 0 = largest city in its country

  -- Filled by the comfort pass. NULL until the first ingest touches this city.
  station_count INTEGER NOT NULL DEFAULT 0,
  pm25_median   REAL,
  comfort       INTEGER,
  worst_signal  TEXT,                      -- the signal costing the most points, for the verdict
  signals_json  TEXT,                      -- {"air":22,"sea":90,...} — absent signals are absent
  -- The readings the scores were derived from, in their own units. A page has to say "9, high"
  -- and "26.4 °C", not "UV scored 26" — the score is the site's opinion, the reading is the fact,
  -- and only one of those belongs in a sentence Google will show.
  readings_json TEXT,
  divergence    REAL,                      -- how far the sensors sit from the model here
  updated_at    TEXT,

  indexable     INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS cities_path ON cities (country_slug, slug);
CREATE INDEX IF NOT EXISTS cities_geo         ON cities (lat, lon);
CREATE INDEX IF NOT EXISTS cities_sitemap     ON cities (indexable, rank);
CREATE INDEX IF NOT EXISTS cities_ranked      ON cities (comfort);

-- ---------------------------------------------------------------------------
-- stations — one Sensor.Community device. Upsert only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stations (
  id            INTEGER PRIMARY KEY,       -- the sensor id upstream, so it is stable across runs
  lat           REAL    NOT NULL,
  lon           REAL    NOT NULL,
  country       TEXT,
  city_id       INTEGER REFERENCES cities (id),
  distance_km   REAL,                      -- to that city; part of the indexing gate
  sensor_type   TEXT,                      -- 'sds011' — from the archive filename, not guessed

  first_seen    TEXT,
  last_seen     TEXT,

  pm25          REAL,
  pm10          REAL,
  pm25_24h      REAL,                      -- from data.24h.json, for the 24h-vs-city-median block

  -- From airq-core's merge(): how far this device sits from the model, and how much the model was
  -- trusted as a result. The page no other air map has.
  divergence    REAL,
  model_weight  REAL,
  merged_pm25   REAL,

  history_days  INTEGER NOT NULL DEFAULT 0,
  indexable     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS stations_city    ON stations (city_id, indexable);
CREATE INDEX IF NOT EXISTS stations_geo     ON stations (lat, lon);
CREATE INDEX IF NOT EXISTS stations_sitemap ON stations (indexable, id);

-- ---------------------------------------------------------------------------
-- history — a rolling window, aggregated to the day.
-- ---------------------------------------------------------------------------
--
-- Deliberately daily, not hourly. Hourly rows for 9 000 stations is 216 000 writes a day, which is
-- over the D1 free write quota before it is over anything else, and a thirty-day chart cannot show
-- an hour anyway.

CREATE TABLE IF NOT EXISTS readings_daily (
  station_id INTEGER NOT NULL REFERENCES stations (id),
  day        TEXT    NOT NULL,             -- 'YYYY-MM-DD', UTC
  pm25       REAL,
  pm10       REAL,
  PRIMARY KEY (station_id, day)
);

CREATE TABLE IF NOT EXISTS city_daily (
  city_id INTEGER NOT NULL REFERENCES cities (id),
  day     TEXT    NOT NULL,
  comfort INTEGER,
  pm25    REAL,
  temp    REAL,
  uv      REAL,
  PRIMARY KEY (city_id, day)
);

-- ---------------------------------------------------------------------------
-- meta — what the last ingest did, so a stale site can say so out loud.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
