-- Real population, from GeoNames.
--
-- `rank` was the only population signal the embedded cities crate carried: position within a
-- country in a list ordered by population, with no number attached. It stays, because the sitemap
-- and the search order use it, but it is now derived from this rather than being the best we had.
ALTER TABLE cities ADD COLUMN population INTEGER;
-- The GeoNames id of the row a city was matched to, so a re-run can tell "already merged" from
-- "coincidentally nearby" without redoing the distance search.
ALTER TABLE cities ADD COLUMN geoname_id INTEGER;
CREATE INDEX IF NOT EXISTS cities_pop ON cities (population DESC);
