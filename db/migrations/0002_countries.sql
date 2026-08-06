-- Country becomes an entity, and the second country vocabulary goes away.
--
-- Two problems, one cause. `cities.country` held the cities database's spelling ("Turkey") while
-- `stations.country` held Sensor.Community's ISO code ("TR"), and nothing joined them — so a
-- country page would have needed a 156-entry name↔ISO mapping. A mapping is what you build when
-- you have accepted two authorities for one fact. The fix is to stop having two.
--
-- `stations.country` is simply deleted. Nothing read it, and a station's country is its city's
-- country — the station page shows the city, the sitemap joins through cities, the map works from
-- coordinates. The ~0.5 % of devices with no city within reach lose nothing: they already fail the
-- indexing gate on `city_id IS NOT NULL` and keep their pin either way.
--
-- `cities.country` and `cities.country_slug` become a foreign key. They were the same two strings
-- repeated 10 596 times, and a country page needs aggregates over them that are far cheaper stored
-- than recomputed per request. ISO lives on `countries` if flags or hreflang ever want it — one
-- nullable column on 156 rows, not a join table.
--
-- Done with ALTER rather than by rebuilding `cities`. The rebuild is the textbook move, but
-- `stations.city_id` and `city_daily.city_id` reference the table, so dropping it is a foreign-key
-- violation — and `PRAGMA defer_foreign_keys` does not help here because it lasts only for the
-- current transaction and wrangler executes each statement separately. Dropping the index first
-- removes the only thing that blocked the column drops, and nothing else has to move.

CREATE TABLE IF NOT EXISTS countries (
  id            INTEGER PRIMARY KEY,
  slug          TEXT    NOT NULL,          -- 'turkey' — the URL segment
  name          TEXT    NOT NULL,          -- 'Turkey' — the cities database's own spelling
  iso           TEXT,                      -- 'TR', when known. Nullable on purpose: unused today

  city_count    INTEGER NOT NULL DEFAULT 0,
  station_count INTEGER NOT NULL DEFAULT 0,
  comfort       INTEGER,
  pm25_median   REAL,
  best_city_id  INTEGER,
  worst_city_id INTEGER,
  updated_at    TEXT,

  indexable     INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS countries_slug ON countries (slug);
CREATE INDEX IF NOT EXISTS countries_size ON countries (station_count DESC);

-- Seeded from what cities already knows, so the migration needs no network and no WASM. The ETL
-- re-seeds the same rows by id afterwards; ordering by name keeps a re-run from reshuffling them.
INSERT OR IGNORE INTO countries (slug, name)
  SELECT DISTINCT country_slug, country FROM cities ORDER BY country;

-- The unique index covers (country_slug, slug), and SQLite will not drop a column an index needs.
DROP INDEX IF EXISTS cities_path;

ALTER TABLE cities ADD COLUMN country_id INTEGER REFERENCES countries (id);

UPDATE cities SET country_id = (
  SELECT co.id FROM countries co WHERE co.slug = cities.country_slug
);

ALTER TABLE cities DROP COLUMN country;
ALTER TABLE cities DROP COLUMN country_slug;

CREATE UNIQUE INDEX IF NOT EXISTS cities_path ON cities (country_id, slug);

-- The redundant column. See the header: a station's country is its city's country.
ALTER TABLE stations DROP COLUMN country;
