/**
 * Where the smoke goes: the place, the satellite fire detections around it, the monitor the plan
 * was checked against, and a plume drawn downwind from each fire for the shift's mean wind.
 *
 * The plume is geometry, not a dispersion model: three hours of the mean 10 m wind as a cone 20°
 * either side of downwind, capped at 120 km; under 4 km/h the smoke pools, drawn as a 15 km circle.
 * It answers one question a crew lead asks at 6 a.m., "is that fire upwind of us", and says so in
 * words under the map. HRRR-Smoke is the real thing and is on the list.
 */

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map as MlMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);

export interface CrewMapProps {
  lat: number;
  lon: number;
  name: string;
  fires: [number, number][];
  monitor: { lat: number; lon: number; name: string; pm25: number } | null;
  wind: { time: string; dir_deg: number; kmh: number }[];
  /** "HH:MM" of the shift's first and last hour, to pick the wind that matters. */
  shift: { start: number; end: number };
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function distanceKm(a: [number, number], b: [number, number]) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Bearing from a to b, degrees clockwise from north. */
function bearing(a: [number, number], b: [number, number]) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `km` away from `from` on bearing `brg`, as [lon, lat] for GeoJSON. */
function destination(from: [number, number], brg: number, km: number): [number, number] {
  const d = km / R;
  const la1 = rad(from[0]);
  const lo1 = rad(from[1]);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(rad(brg)));
  const lo2 = lo1 + Math.atan2(Math.sin(rad(brg)) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [deg(lo2), deg(la2)];
}

const HALF_ANGLE = 20;
const HOURS = 3;
const CALM_KMH = 4;
const POOL_KM = 15;

/** Vector mean of the shift's wind: direction the wind comes from, and speed. */
function meanWind(wind: CrewMapProps["wind"], shift: CrewMapProps["shift"]) {
  const rows = wind.filter((w) => {
    const h = Number(w.time.slice(11, 13));
    return h >= shift.start && h < shift.end;
  });
  const use = rows.length ? rows : wind;
  if (!use.length) return null;
  let x = 0;
  let y = 0;
  for (const w of use) {
    x += w.kmh * Math.sin(rad(w.dir_deg));
    y += w.kmh * Math.cos(rad(w.dir_deg));
  }
  const kmh = Math.hypot(x, y) / use.length;
  const from = (deg(Math.atan2(x, y)) + 360) % 360;
  return { from, kmh, hours: use.length };
}

function plume(fire: [number, number], w: { from: number; kmh: number }): GeoJSON.Polygon {
  if (w.kmh < CALM_KMH) {
    const ring = Array.from({ length: 37 }, (_, i) => destination(fire, i * 10, POOL_KM));
    return { type: "Polygon", coordinates: [ring] };
  }
  const to = (w.from + 180) % 360;
  const len = Math.min(120, Math.max(15, w.kmh * HOURS));
  const arc = Array.from({ length: 9 }, (_, i) => destination(fire, to - HALF_ANGLE + (i * HALF_ANGLE * 2) / 8, len));
  const origin: [number, number] = [fire[1], fire[0]];
  return { type: "Polygon", coordinates: [[origin, ...arc, origin]] };
}

/** Is the place inside this fire's plume: downwind within the cone, or inside the calm pool. */
function reaches(fire: [number, number], place: [number, number], w: { from: number; kmh: number }) {
  const d = distanceKm(fire, place);
  if (w.kmh < CALM_KMH) return d <= POOL_KM;
  const len = Math.min(120, Math.max(15, w.kmh * HOURS));
  if (d > len) return false;
  const to = (w.from + 180) % 360;
  const off = Math.abs((((bearing(fire, place) - to) % 360) + 540) % 360 - 180);
  return off <= HALF_ANGLE;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (d: number) => COMPASS[Math.round(d / 45) % 8];

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function CrewMap(p: CrewMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");
  const place: [number, number] = [p.lat, p.lon];
  const w = meanWind(p.wind, p.shift);
  const near = p.fires.map((f) => ({ f, km: distanceKm(f, place) })).filter((x) => x.km <= 150).sort((a, b) => a.km - b.km);

  useEffect(() => {
    if (!holder.current) return;
    const dark = isDark();
    const m = new MlMap({
      container: holder.current,
      style: dark
        ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [p.lon, p.lat],
      zoom: 8,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const plumes: GeoJSON.Feature[] = [];
    let inside: { km: number; dir: string } | null = null;
    if (w) {
      for (const { f, km } of near) {
        const hit = reaches(f, place, w);
        plumes.push({ type: "Feature", geometry: plume(f, w), properties: { hit } });
        if (hit && !inside) inside = { km, dir: compass(bearing(place, f)) };
      }
    }
    const fires: GeoJSON.Feature[] = near.map(({ f, km }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [f[1], f[0]] },
      properties: { km: Math.round(km) },
    }));

    setNote(
      !w
        ? "No wind forecast for these hours, so no plume is drawn."
        : near.length === 0
          ? "No satellite fire detections within 150 km in the last 24 h."
          : w.kmh < CALM_KMH
            ? `Calm (${Math.round(w.kmh)} km/h): smoke pools near each fire; the nearest is ${Math.round(near[0]!.km)} km ${compass(bearing(place, near[0]!.f))}${inside ? ", and this place is inside its pool" : ""}.`
            : inside
              ? `Wind from the ${compass(w.from)} at ${Math.round(w.kmh)} km/h: the fire ${inside.km} km ${inside.dir} is upwind, its plume reaches this place within about ${HOURS} hours. Trust the sky over the forecast.`
              : `Wind from the ${compass(w.from)} at ${Math.round(w.kmh)} km/h: none of the ${near.length} fires within 150 km is upwind of this place today.`,
    );

    m.on("load", () => {
      m.addSource("plumes", { type: "geojson", data: { type: "FeatureCollection", features: plumes } });
      m.addLayer({
        id: "plumes",
        type: "fill",
        source: "plumes",
        paint: { "fill-color": ["case", ["get", "hit"], "#E8551C", "#F2A23A"], "fill-opacity": ["case", ["get", "hit"], 0.32, 0.18] },
      });
      m.addLayer({ id: "plumes-line", type: "line", source: "plumes", paint: { "line-color": "#E8551C", "line-width": 1, "line-opacity": 0.6 } });
      m.addSource("fires", { type: "geojson", data: { type: "FeatureCollection", features: fires } });
      m.addLayer({
        id: "fires",
        type: "circle",
        source: "fires",
        paint: { "circle-radius": 5, "circle-color": "#D7263D", "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 },
      });
      const pins: GeoJSON.Feature[] = [
        { type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { kind: "place", label: p.name } },
      ];
      if (p.monitor)
        pins.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.monitor.lon, p.monitor.lat] },
          properties: { kind: "monitor", label: `${p.monitor.name} · ${p.monitor.pm25} µg/m³` },
        });
      m.addSource("pins", { type: "geojson", data: { type: "FeatureCollection", features: pins } });
      m.addLayer({
        id: "pins",
        type: "circle",
        source: "pins",
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "place"], 8, 6],
          "circle-color": ["case", ["==", ["get", "kind"], "place"], "#3D74C4", "#2E9E5B"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      m.addLayer({
        id: "pin-labels",
        type: "symbol",
        source: "pins",
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top" },
        paint: { "text-color": dark ? "#FBF7F2" : "#121826", "text-halo-color": dark ? "#121826" : "#FFFFFF", "text-halo-width": 1.2 },
      });
      // Fit the place, the monitor and the fires that matter (within 100 km), never the whole state.
      const pts: [number, number][] = [[p.lon, p.lat]];
      if (p.monitor) pts.push([p.monitor.lon, p.monitor.lat]);
      for (const { f, km } of near) if (km <= 100) pts.push([f[1], f[0]]);
      if (pts.length > 1) {
        const lons = pts.map((q) => q[0]);
        const lats = pts.map((q) => q[1]);
        m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 48, maxZoom: 10, duration: 0 });
      }
      (m.getSource("fires") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: fires });
    });
    return () => m.remove();
    // The props are server-rendered once per page; nothing changes after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="crew-map">
      <div ref={holder} className="crew-map-canvas" aria-label="Map of fires, the monitor and smoke plumes around the place" />
      <p className="crew-map-note">{note}</p>
    </div>
  );
}
