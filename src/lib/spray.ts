/**
 * The spraying window: FAO's wind table for ground application of pesticides, hour by hour.
 *
 * FAO, Guidelines on Good Practice for Ground Application of Pesticides (2001), §4.2.2 Table 1:
 * under 3 km/h do not spray (calm air means inversions and drift that hangs), 3–7 km/h ideal,
 * 7–10 km/h avoid herbicides, above 10 km/h do not spray. Turkey's regulation (Bitki Koruma
 * Ürünlerinin Uygulanması ve Denetimine İlişkin Yönetmelik, RG 13.12.2025) sets no number: it binds
 * the product label and requires drift prevention. FAO gives no temperature cut-off either, so none
 * is invented here. The forecast wind is at 10 m, which reads higher than at boom height.
 *
 * Pure, so the classes are tested (tests/spray.test.ts).
 */

export type SprayClass = "calm" | "ideal" | "no-herbicide" | "windy";

export function sprayClass(kmh: number): SprayClass {
  if (kmh < 3) return "calm";
  if (kmh <= 7) return "ideal";
  if (kmh <= 10) return "no-herbicide";
  return "windy";
}

/** Runs of consecutive ideal hours, as clock ranges: `[{from: "07:00", to: "10:00"}]` (`to` exclusive). */
export function sprayWindows(wind: { time: string; kmh: number }[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const hourAfter = (t: string) => `${String(Number(t.slice(11, 13)) + 1).padStart(2, "0")}:00`;
  for (const w of wind) {
    const ok = sprayClass(w.kmh) === "ideal";
    if (ok && start === null) start = w.time.slice(11, 16);
    if (!ok && start !== null) {
      out.push({ from: start, to: hourAfter(prev!) });
      start = null;
    }
    prev = w.time;
  }
  if (start !== null && prev) out.push({ from: start, to: hourAfter(prev) });
  return out;
}
