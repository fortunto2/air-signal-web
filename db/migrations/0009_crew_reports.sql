-- Worker reports on /crew: the first rung of the ladder (worker → crew lead → anonymous escalation).
--
-- Cal/OSHA §5141.1 makes the employer encourage workers to report worse air and symptoms. A report
-- here is that report, with the evidence attached at the moment it was made: the NowCast hour, the
-- nearest satellite fire, the ground monitor. No name, no phone, no IP: `sender` is a salted hash
-- that changes daily, kept only to stop one device flooding a site.
--
-- This is the second write surface the worker has (CLAUDE.md): it creates these rows and marks them
-- handled. It never touches places, stations or readings.
CREATE TABLE IF NOT EXISTS crew_reports (
  id            INTEGER PRIMARY KEY,
  site          TEXT    NOT NULL,          -- slug of the geocoded place, 'fresno-california'
  date          TEXT    NOT NULL,          -- the shift's day, local, '2026-10-24'
  created_at    TEXT    NOT NULL,          -- ISO UTC
  kind          TEXT    NOT NULL,          -- smoke | ash | symptoms | no_n95 | no_shade | no_water | other
  note          TEXT,                      -- up to 280 characters, free text
  evidence_json TEXT,                      -- the plan's facts for the hour the report was made
  sender        TEXT    NOT NULL,          -- sha-256(ip + day + salt), first 16 hex
  status        TEXT    NOT NULL DEFAULT 'open',  -- open | handled
  handled_at    TEXT,
  handled_note  TEXT
);

CREATE INDEX IF NOT EXISTS crew_reports_site ON crew_reports (site, date, created_at);
CREATE INDEX IF NOT EXISTS crew_reports_sender ON crew_reports (sender, created_at);
