/**
 * Wall-clock arithmetic in an IANA zone, with nothing but `Intl`. Import-free, so the calendar file,
 * the CAISO cron and the crew plan share one idea of "today" and "this hour" in a place, and the
 * tests run under plain Node.
 *
 * Every plan is in its place's own zone (a crew in Fresno and one in Berlin both read 07:00 as their
 * 07:00); CAISO's files are Pacific regardless, hence the one named constant.
 */

export const PACIFIC = "America/Los_Angeles";

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formats.set(tz, f);
  }
  return f;
}

interface Parts { year: string; month: string; day: string; hour: number; minute: number }

function parts(d: Date, tz: string): Parts {
  const p: Record<string, string> = {};
  for (const x of format(tz).formatToParts(d)) p[x.type] = x.value;
  // Some engines print midnight as "24" under h23 for the day's last instant; fold it.
  const hour = Number(p.hour) % 24;
  return { year: p.year!, month: p.month!, day: p.day!, hour, minute: Number(p.minute) };
}

/** The calendar day at `d` in `tz`: "2026-10-25". */
export function localDay(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The hour at `d` in `tz`, in the forecast's shape: "2026-10-25T07:00". */
export function localHour(d: Date | string, tz: string): string {
  const p = parts(typeof d === "string" ? new Date(d) : d, tz);
  return `${p.year}-${p.month}-${p.day}T${String(p.hour).padStart(2, "0")}:00`;
}

/** 0–23: the hour of the day at `d` in `tz`. */
export function localHourNumber(d: Date, tz: string): number {
  return parts(d, tz).hour;
}

/** `day` plus `days` calendar days, as a day string (no zone needed: a day is a day). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes east of UTC that `tz` keeps at the instant `d`. */
export function utcOffsetMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), p.hour, p.minute);
  return Math.round((asUtc - (d.getTime() - (d.getTime() % 60_000))) / 60_000);
}

/**
 * The instant when `day`'s wall clock in `tz` reads `hour`:00; `hour` may be 24 (the next midnight).
 * Two passes, because the offset can change between the guess and the answer on a DST day.
 */
export function zonedToUtc(day: string, hour: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - utcOffsetMinutes(new Date(guess), tz) * 60_000;
  const second = guess - utcOffsetMinutes(new Date(first), tz) * 60_000;
  return new Date(second);
}
