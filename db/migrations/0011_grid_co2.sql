-- grid_co2 — the CAISO grid's hourly carbon intensity, g CO2 per kWh, one row per local hour per day.
--
-- Filled by the Worker's cron (src/lib/grid-co2.ts, every 30 minutes) from CAISO Today's Outlook:
-- Σ CO2 (metric tons per hour, imports in, exports out) ÷ demand (MW) × 1000, averaged over the 5-minute
-- rows of each hour. Fourteen days are kept; /crew shows the median of the last seven for each hour as
-- "typical", a pattern, never a forecast. The one table the Worker writes besides crew_reports.
CREATE TABLE IF NOT EXISTS grid_co2 (
  day        TEXT    NOT NULL,   -- CAISO's day, Pacific, '2026-10-24'
  hour       INTEGER NOT NULL,   -- 0–23, Pacific; -1 marks a day whose history file failed (samples 0)
  g_per_kwh  REAL    NOT NULL,   -- mean of the hour's 5-minute intensities
  samples    INTEGER NOT NULL,   -- how many 5-minute rows the mean has (12 when complete)
  updated_at TEXT    NOT NULL,   -- ISO UTC
  PRIMARY KEY (day, hour)
);
