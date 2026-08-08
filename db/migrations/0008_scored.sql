-- How many of a country's cities the median was actually taken from.
--
-- Warming the largest city of every country filled the ninety blank rows, and created a claim that
-- needed qualifying: Iran's 20.4 µg/m³ comes from Tehran alone, Germany's 2.0 from 2 885 cities and
-- 3 575 devices. Both were printed beside "N cities", which is the country's size and not the
-- sample. This is the sample.
ALTER TABLE countries ADD COLUMN scored_cities INTEGER NOT NULL DEFAULT 0;
