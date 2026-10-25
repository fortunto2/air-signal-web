/**
 * Backup battery sizing for a house on a smoke or heat day: three things people actually need to
 * keep running, times the hours the grid is dearest or an alert lasts, with a margin.
 *
 * Arithmetic, not a load study: the numbers are typical running draws (a fridge's compressor averaged
 * over its cycle, a CPAP without a humidifier, a phone charger and a home router). Deterministic so
 * the sheet prints the same table every time for the same plan.
 */

import type { CrewAnswer } from "./crew";

export const BACKUP_PRESETS = [
  { name: "Fridge", watts: 150 },
  { name: "CPAP", watts: 40 },
  { name: "Phone and router", watts: 20 },
] as const;

/** Energy above the arithmetic, for inverter losses and a battery that should not be run flat. */
export const BACKUP_MARGIN = 0.2;
export const BACKUP_MIN_HOURS = 4;
/** An alert that runs for days still sizes a battery for one of them. */
export const BACKUP_MAX_HOURS = 24;

export interface BackupRow {
  name: string;
  watts: number;
  hours: number;
  /** kWh with the margin, rounded up to 0.1. */
  kwh: number;
}

/**
 * How many hours to size for: the peak price window (16–21 is 5 h), or the longest active alert when
 * it is longer, never under 4 h and never over 24. Which one was used is returned with the hours.
 */
export function backupHours(home: NonNullable<CrewAnswer["home"]>, alerts: CrewAnswer["alerts"]): { hours: number; basis: string } {
  const peak = home.peak_price.end - home.peak_price.start;
  let hours = Math.max(BACKUP_MIN_HOURS, peak);
  let basis = peak >= BACKUP_MIN_HOURS ? `the ${home.peak_price.start}:00–${home.peak_price.end}:00 peak price` : `a ${BACKUP_MIN_HOURS} h minimum`;
  for (const a of alerts) {
    if (!a.onset || !a.ends) continue;
    const span = Math.ceil((Date.parse(a.ends) - Date.parse(a.onset)) / 3_600_000);
    if (!Number.isFinite(span) || span <= hours) continue;
    hours = Math.min(BACKUP_MAX_HOURS, span);
    basis = span > BACKUP_MAX_HOURS ? `the ${a.event} (${span} h; one day sized)` : `the ${a.event} window`;
  }
  return { hours, basis };
}

/** The table: every preset at `hours`, kWh with the margin, rounded up to 0.1. */
export function backupSizing(hours: number): BackupRow[] {
  return BACKUP_PRESETS.map((p) => ({
    name: p.name,
    watts: p.watts,
    hours,
    kwh: Math.ceil((p.watts * hours * (1 + BACKUP_MARGIN)) / 100) / 10,
  }));
}
