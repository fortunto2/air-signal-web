-- observations — what people notice about their own air (the Air Signal app): a kind, a 1–5 intensity, the
-- minute, a point rounded to two decimals (~1 km) by the server, and the evidence the server derived for
-- that hour (NowCast, monitor, fire, wind). Its own table because it is not a crew report: no site board,
-- no status, no handling, and a reader who wants to set perceptions against monitors wants rows shaped
-- like this. POST /api/report writes here; crew_reports.app = 'airsignal' rows are the one release before.
-- Retention as the privacy page says: sender erased after 2 days, rows after 24 months (lib/db.ts).
CREATE TABLE IF NOT EXISTS observations (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT    NOT NULL,          -- ISO UTC, when the server received it
  observed_at   TEXT    NOT NULL,          -- ISO UTC to the minute, when the person observed it
  date          TEXT    NOT NULL,          -- the local day at the place, '2026-10-25'
  hour          TEXT    NOT NULL,          -- the local hour the evidence is for, '2026-10-25T06:00'
  tz            TEXT    NOT NULL,          -- IANA zone of `date` and `hour`
  lat           REAL    NOT NULL,          -- two decimals
  lon           REAL    NOT NULL,
  site          TEXT    NOT NULL,          -- the nearest place's key (lib/crew.ts siteKey), for grouping
  kind          TEXT    NOT NULL,          -- smoke_smell | haze | ash | dust | chemical_odour | clear
  intensity     INTEGER NOT NULL,          -- 1–5
  sky_smoke     REAL,                      -- the sky check's smoke probability 0–1, if attached
  snapshot_json TEXT,                      -- the phone's own evidence, kept for comparison only
  evidence_json TEXT    NOT NULL,          -- the server's evidence for `hour`
  sender        TEXT    NOT NULL           -- sha-256(ip + day + salt), first 16 hex; erased after 2 days
);

CREATE INDEX IF NOT EXISTS observations_created ON observations (created_at);
CREATE INDEX IF NOT EXISTS observations_sender ON observations (sender, created_at);
CREATE INDEX IF NOT EXISTS observations_site_date ON observations (site, date);
