/**
 * Live readings for a city.
 *
 * This island renders almost nothing. Its job is to take what the server already wrote into the
 * HTML and make it current — the score, the spectrum, the per-signal grid, the timestamp. If it
 * never runs, the page is complete and correct as of the last ingest; if it runs, the page is
 * correct as of a minute ago. Those are the only two states allowed.
 *
 * That is also why it patches the DOM instead of rendering its own copy of the readout. A second
 * React-owned score sitting next to the server's would be two sources of truth on one screen, and
 * the one a crawler reads would be the one nobody maintains.
 *
 * The WASM it loads is the slim build — 216 KB, no cities database — behind `client:visible`, so
 * it is off the critical path entirely.
 */

import { useEffect, useState } from "react";
import { comfortFrom, scoresFrom, type Readings, type SignalCore } from "../lib/signals";
import { SIGNALS, comfortBand, type SignalKey } from "../lib/site";

interface Props {
  lat: number;
  lon: number;
  cityName: string;
}

type State = "idle" | "loading" | "done" | "failed";

export default function LiveCity({ lat, lon }: Props) {
  const [state, setState] = useState<State>("idle");
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState("loading");
      try {
        const [core, readings] = await Promise.all([loadCore(), fetchReadings(lat, lon)]);
        if (cancelled) return;

        const comfort = comfortFrom(core, scoresFrom(core, readings));
        paint(comfort.total, comfort.scores);
        setAt(new Date());
        setState("done");
      } catch {
        // A failed refresh leaves the server's numbers exactly as they were, which is the correct
        // outcome — they are real, just older. Saying nothing would be the bug.
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  // Always renders the line, even while idle. An island that returns `null` has no box, and a
  // component with no box never intersects the viewport — which is how this shipped once with
  // `client:visible` and simply never ran. It is `client:idle` now, and the line reserves its row
  // either way so nothing shifts when the state changes.
  return (
    <p
      className="eyebrow"
      style={{ padding: "10px 4px 0", textAlign: "right", minHeight: "1.4em" }}
      aria-live="polite"
    >
      {state === "done"
        ? `Refreshed live at ${at?.toISOString().slice(11, 16)} UTC`
        : state === "failed"
          ? "Could not refresh — showing the last computed values"
          : state === "loading"
            ? "Refreshing…"
            : ""}
    </p>
  );
}

// ── the update ──────────────────────────────────────────────────────────────

/**
 * Patch what the server rendered.
 *
 * Every element touched here was already in the HTML with a real value. Nothing is created, so
 * there is no arrangement in which this function is what makes the page readable.
 */
function paint(total: number, scores: Partial<Record<SignalKey, number>>) {
  const band = comfortBand(total);

  const score = document.querySelector<HTMLElement>('[data-live="comfort"]');
  if (score) {
    score.textContent = String(total);
    score.className = `value fg-${band}`;
  }

  const word = document.querySelector<HTMLElement>(".verdict .word");
  if (word) word.className = `word fg-${band}`;

  const cols = document.querySelectorAll<HTMLElement>(".spectrum .col");
  SIGNALS.forEach((s, i) => {
    const col = cols[i];
    const fill = col?.querySelector<HTMLElement>(".bar-fill");
    if (!col || !fill) return;

    const v = scores[s.key];
    if (v === undefined) {
      col.classList.add("is-absent");
      fill.className = "bar-fill";
      fill.style.height = "";
      fill.title = `${s.name} — no reading`;
      return;
    }
    col.classList.remove("is-absent");
    fill.className = `bar-fill scale-${comfortBand(v)}`;
    fill.style.height = `${Math.max(4, v)}%`;
    fill.title = `${s.name} — ${v}/100`;
  });

  const cells = document.querySelectorAll<HTMLElement>(".grid-signals .sig");
  SIGNALS.forEach((s, i) => {
    const cell = cells[i];
    if (!cell) return;
    const v = scores[s.key];
    const pts = cell.querySelector<HTMLElement>(".pts");
    const track = cell.querySelector<HTMLElement>(".track i");
    if (pts) pts.textContent = v === undefined ? "—" : String(v);
    if (track && v !== undefined) {
      track.className = `scale-${comfortBand(v)}`;
      track.style.width = `${v}%`;
    }
  });
}

// ── inputs ──────────────────────────────────────────────────────────────────

let corePromise: Promise<SignalCore> | null = null;

/** Loaded once per page, lazily. The `?url` import keeps the binary out of the JS bundle. */
function loadCore(): Promise<SignalCore> {
  corePromise ??= (async () => {
    const [mod, wasmUrl] = await Promise.all([
      import("../wasm/web/airq_core.js"),
      import("../wasm/web/airq_core_bg.wasm?url").then((m) => m.default),
    ]);
    await (mod as unknown as { default: (o: unknown) => Promise<unknown> }).default({
      module_or_path: wasmUrl,
    });
    return mod as unknown as SignalCore;
  })();
  return corePromise;
}

/**
 * Straight from the upstreams, no server in between.
 *
 * Every one of these sends `access-control-allow-origin: *`, which is the whole reason this site
 * has no API routes. NASA FIRMS does not, so fire is left to the server-side value already on the
 * page rather than being dropped — refreshing a page must never remove a reading from it.
 */
async function fetchReadings(lat: number, lon: number): Promise<Readings> {
  const q = `latitude=${lat}&longitude=${lon}`;

  const [weather, air, marine, sensors] = await Promise.all([
    json(
      `https://api.open-meteo.com/v1/forecast?${q}` +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl" +
        "&hourly=uv_index&daily=sunrise,sunset&forecast_days=1&timezone=UTC&wind_speed_unit=kmh",
    ),
    json(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${q}` +
        "&current=pm2_5,pm10,alder_pollen,birch_pollen,grass_pollen,olive_pollen,ragweed_pollen",
    ),
    json(
      `https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,sea_surface_temperature`,
    ).catch(() => null),
    json(
      `https://data.sensor.community/airrohr/v1/filter/area=${lat},${lon},15`,
    ).catch(() => null),
  ]);

  // Community sensors are ground truth where they exist; the model is the fallback. Same ordering
  // as the ETL, so hydration cannot flip a page from sensor-backed to modelled and back.
  const sensorPm25 = medianPm25(sensors);
  const cur = weather?.current ?? {};
  const acur = air?.current ?? {};

  const sunrise = weather?.daily?.sunrise?.[0];
  const sunset = weather?.daily?.sunset?.[0];

  const pollens = [
    acur.alder_pollen,
    acur.birch_pollen,
    acur.grass_pollen,
    acur.olive_pollen,
    acur.ragweed_pollen,
  ]
    .map(Number)
    .filter((n) => Number.isFinite(n));

  return {
    pm25: sensorPm25 ?? numOr(acur.pm2_5),
    temperatureC: numOr(cur.temperature_2m),
    humidityPct: numOr(cur.relative_humidity_2m),
    windKmh: numOr(cur.wind_speed_10m),
    pressureHpa: numOr(cur.pressure_msl),
    uv: numOr(weather?.hourly?.uv_index?.[new Date().getUTCHours()]),
    daylightHours:
      sunrise && sunset ? (Date.parse(sunset) - Date.parse(sunrise)) / 3_600_000 : undefined,
    waveHeightM: numOr(marine?.current?.wave_height),
    pollen: pollens.length ? Math.max(...pollens) : undefined,
  };
}

async function json(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function numOr(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Median, not mean — one broken device beside a road must not move the city's number. */
function medianPm25(rows: any): number | undefined {
  if (!Array.isArray(rows)) return undefined;
  const values: number[] = [];
  for (const row of rows) {
    if (Number(row?.location?.indoor) === 1) continue;
    for (const v of row?.sensordatavalues ?? []) {
      const n = Number.parseFloat(v?.value);
      // Outside this window is a broken sensor, not clean or catastrophic air.
      if (v?.value_type === "P2" && Number.isFinite(n) && n > 0 && n <= 500) values.push(n);
    }
  }
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}
