-- Air Signal's citizen observations share the crew_reports table (one report endpoint), but they are
-- not crew reports: `app` says which app sent a row, and /crew's boards show only 'crewair'. The
-- observation itself (kind smoke_smell|haze|ash|dust|chemical_odour|clear, intensity 1–5, observed_at,
-- the phone's evidence snapshot) is kept whole in `observation_json`; `kind` stays the nearest crew kind
-- so every existing reader keeps working. Additive, no row changes: every existing row is 'crewair'.
ALTER TABLE crew_reports ADD COLUMN app TEXT NOT NULL DEFAULT 'crewair';
ALTER TABLE crew_reports ADD COLUMN observation_json TEXT;
