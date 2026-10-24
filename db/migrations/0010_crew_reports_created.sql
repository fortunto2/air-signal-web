-- Retention runs by age (lib/db.ts purgeOldReports): without an index leading with created_at, the
-- UPDATE and DELETE read the whole table on every report.
CREATE INDEX IF NOT EXISTS crew_reports_created ON crew_reports (created_at);
