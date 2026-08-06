-- Store the raw readings alongside the derived scores.
--
-- The scores are what the comfort index is built from; the readings are what a page has to print.
-- "UV 26/100" is the site's opinion, "UV index 9, high" is the fact, and it is the fact that goes
-- in the verdict sentence, the meta description and the JSON-LD.
ALTER TABLE cities ADD COLUMN readings_json TEXT;
