import type { APIRoute } from "astro";
import { getLastIngest, getStationPoints } from "../../lib/db";
import { QUIET_AFTER_MINUTES } from "../../lib/view";
import { paths } from "../../lib/site";

/**
 * The high-zoom layer: the devices themselves.
 *
 * Nine thousand points is about 400 KB of GeoJSON, which sounds like a lot until you compare it
 * with a query per pan. It is fetched once, cached at the edge for the life of an ingest, and then
 * MapLibre does the clustering on the GPU. `bbox` is honoured when supplied so the shape is ready
 * for a network several times this size, but the default is to send everything.
 */
export const GET: APIRoute = async ({ url }) => {
  const bboxParam = url.searchParams.get("bbox");
  const bbox = bboxParam
    ? (bboxParam.split(",").map(Number) as [number, number, number, number])
    : undefined;

  const [rows, lastIngest] = await Promise.all([
    getStationPoints(bbox && bbox.every(Number.isFinite) ? bbox : undefined),
    getLastIngest(),
  ]);

  /**
   * Age is measured from the ingest, not from now.
   *
   * `last_seen` only moves when the ETL runs, so measuring against the wall clock meant every
   * device on Earth turned hollow a couple of hours after each pass and stayed that way until the
   * next one — a map of 9 288 grey rings for most of the day, announcing an outage that was ours.
   *
   * Against the ingest it says what it was always meant to say: this device was not reporting when
   * we last looked. `Math.min` keeps it honest if the ETL somehow ran in the future, and a missing
   * ingest timestamp falls back to now.
   */
  const asOf = Math.min(lastIngest?.getTime() ?? Date.now(), Date.now());

  // Four decimal places is about eleven metres. Sensor.Community publishes coordinates rounded to
  // roughly a street anyway (deliberately, so a reading is not a home address), so the extra digits
  // were pure payload — they cost ~200 KB across nine thousand points and buy nothing visible.
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

  const body = JSON.stringify({
    type: "FeatureCollection",
    features: rows.map((s) => {
      // Sensor.Community timestamps are "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
      const seen = s.last_seen ? Date.parse(s.last_seen.replace(" ", "T") + "Z") : NaN;
      const ageMin = Number.isFinite(seen) ? Math.max(0, Math.round((asOf - seen) / 60_000)) : 99_999;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [r4(s.lon), r4(s.lat)] },
        properties: {
          id: s.id,
          // The pin's own page. Null for the handful of devices with no city — they stay on the
          // map because a reading is a reading, but they have no page to open.
          path:
            s.country_slug && s.city_slug
              ? paths.station(s.country_slug, s.city_slug, s.id)
              : null,
          place: s.city_name,
          hw: s.sensor_type,
          pm25: s.pm25 === null ? -1 : Math.round(s.pm25 * 10) / 10,
          // Capped: the radius ramp flattens past two hours, so a device silent for three weeks
          // and one silent for three hours are drawn identically and may as well travel that way.
          age: Math.min(ageMin, 180),
          // A device that has not spoken in two hours is drawn hollow rather than removed: gone
          // quiet is information, and deleting the pin would claim the sensor never existed.
          quiet: ageMin > QUIET_AFTER_MINUTES ? 1 : 0,
        },
      };
    }),
  });

  return new Response(body, {
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
    },
  });
};
