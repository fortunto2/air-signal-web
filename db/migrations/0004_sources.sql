-- Pollution sources from OpenStreetMap.
--
-- The Rust CLI has discovered these since early on and the site never had them: the Overpass call
-- lives in the `airq` binary crate, on reqwest and a filesystem cache, so it was never part of the
-- WASM that the worker and the browser share. Only the shape of the answer, `PollutionSource`, made
-- it into airq-core.
--
-- Attached to a city rather than to a coordinate because that is how the pages are organised, and
-- because a query per page view against a public Overpass instance would be both slow and rude.
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY,
  city_id     INTEGER NOT NULL REFERENCES cities (id),
  osm_id      TEXT    NOT NULL,          -- 'way/12345', so a re-run updates rather than duplicates
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,          -- power_plant | works | industrial | motorway | trunk
  lat         REAL    NOT NULL,
  lon         REAL    NOT NULL,
  distance_km REAL    NOT NULL,
  bearing_deg REAL,                      -- from the city centre, so the map can draw the sector
  updated_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sources_osm  ON sources (city_id, osm_id);
CREATE INDEX        IF NOT EXISTS sources_city ON sources (city_id, distance_km);
