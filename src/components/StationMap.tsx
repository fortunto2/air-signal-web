/**
 * The map. Not an illustration under the fold — it is the product's front door.
 *
 * Two layers, chosen by zoom, because they answer two different questions:
 *
 *   zoom < 8   one dot per city, sized by how many devices it has, coloured by their median.
 *              Over Germany that is 3 500 sensors in a thumbnail; nobody compares two boxes in
 *              Stuttgart from orbit, they ask "how is Stuttgart".
 *   zoom >= 8  the devices themselves, clustered by MapLibre with the cluster's own mean PM2.5
 *              computed on the GPU via `clusterProperties`. Pin colour is the reading, radius is
 *              recency, and a hollow ring means the station has gone quiet.
 *
 * MapLibre rather than Leaflet for one concrete reason: colour, radius and stroke are data-driven
 * paint expressions here, which is exactly how the design describes them. In Leaflet they would be
 * nine thousand DOM nodes carrying inline styles.
 */

import { useEffect, useRef, useState } from "react";
// Named imports: maplibre-gl v6 dropped the default export, and importing the namespace pulls the
// whole module into the type graph for two symbols.
import {
  AttributionControl,
  GeoJSONSource,
  Map as MlMap,
  NavigationControl,
  type ExpressionSpecification,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Vite bundles the worker and hands back its URL. Without this, MapLibre computes the URL itself
// from `import.meta.url`, Vite never emits the file, and `new Worker(...)` points at nothing — the
// pool starts dead. Nothing errors: `load` simply never fires, no data event ever arrives, and the
// map sits on "Loading sensors…" over a blank canvas forever. Every GeoJSON source is parsed on
// that worker, so on this map it means no pins at all.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { setWorkerUrl } from "maplibre-gl";
import { pmBand } from "../lib/site";

setWorkerUrl(maplibreWorkerUrl);

const CITY_ZOOM_MAX = 8;

interface Selected {
  id: number;
  name?: string;
  path?: string;
  pm25: number;
  quiet: boolean;
  kind: "city" | "station";
}

/** Reads a token off the document so the map's palette follows the site's, in both themes. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function bandColours() {
  return {
    excellent: token("--s-excellent"),
    good: token("--s-good"),
    fair: token("--s-fair"),
    poor: token("--s-poor"),
    bad: token("--s-bad"),
    quiet: token("--ink-3"),
    line: token("--line"),
    lineSoft: token("--line-soft"),
    ground: token("--ground"),
    surface: token("--surface"),
    ink: token("--ink"),
    ink3: token("--ink-3"),
    accent: token("--accent"),
  };
}

/**
 * A basemap built from our own tokens rather than someone's tiles.
 *
 * There is no raster source here at all. A CARTO or OSM basemap arrives pre-coloured, and on a site
 * whose one rule is that colour belongs to the data, a beige-and-green map would out-shout every
 * reading on it. What a reader needs behind the pins is a graticule and a sense of scale, and both
 * are cheap to draw. It also means no third-party request before first paint, and no attribution
 * obligation to a CDN that might start charging.
 */
function style(c: ReturnType<typeof bandColours>): StyleSpecification {
  return {
    version: 8,
    // No `glyphs` key at all. MapLibre validates it as a string when present, and `undefined`
    // fails the style outright — which is also why there are no text layers here: a label needs a
    // font server, and hosting one to print a cluster count would be a third-party request in
    // front of a page whose whole promise is that the reading is already on screen.
    sources: {
      graticule: {
        type: "geojson",
        data: graticule(),
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.ground } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": c.lineSoft, "line-width": 1 },
      },
    ],
  };
}

/** Meridians and parallels every 10°, as plain GeoJSON. The whole basemap, in about ten lines. */
function graticule(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lon = -180; lon <= 180; lon += 10) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[lon, -85], [lon, 85]] },
    });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] },
    });
  }
  return { type: "FeatureCollection", features };
}

interface Props {
  /** Opening view. A city page centres on itself; /map/ opens on the sensor-dense part of Europe. */
  lat?: number;
  lon?: number;
  zoom?: number;
}

export default function StationMap({ lat = 50.5, lon = 10.5, zoom = 4 }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof MlMap> | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!holder.current || map.current) return;
    const c = bandColours();

    const m = new MlMap({
      container: holder.current,
      style: style(c),
      center: [lon, lat],
      zoom,
      attributionControl: false,
      // The graticule has no labels, so there is nothing to rotate out of legibility — but a map
      // that tilts under a stray gesture is a map the reader has to fix. Keep it flat.
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.current = m;
    // A handle for debugging a map that will not draw. Costs nothing and saves a build cycle every
    // time a paint expression is wrong — which, on a map whose whole design is paint expressions,
    // is often.
    (window as unknown as { __airsignalMap?: unknown }).__airsignalMap = m;

    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: "Sensor.Community (ODbL) · Open-Meteo",
      }),
      "bottom-right",
    );
    m.keyboard.enable();

    // Without this, MapLibre swallows style and expression failures: the `error` event has no
    // listener, `load` never fires, and the only symptom is a permanent "Loading sensors…" over a
    // blank canvas. Which is exactly how this shipped.
    m.on("error", (e) => {
      const message = (e as { error?: Error }).error?.message ?? String(e);
      console.error("[map]", message);
      setFailed(message);
    });

    m.on("load", () => {
      const step = (prop: string): ExpressionSpecification =>
        [
          "step",
          ["get", prop],
          c.excellent,
          10, c.good,
          20, c.fair,
          35, c.poor,
          55, c.bad,
        ] as ExpressionSpecification;

      // ── cities, low zoom ──
      m.addSource("cities", { type: "geojson", data: "/api/cities.geojson" });
      m.addLayer({
        id: "cities",
        type: "circle",
        source: "cities",
        maxzoom: CITY_ZOOM_MAX,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "n"],
            1, 4,
            10, 8,
            50, 13,
            300, 20,
          ],
          "circle-color": ["case", ["<", ["get", "pm25"], 0], c.quiet, step("pm25")],
          "circle-opacity": 0.82,
          "circle-stroke-width": 1,
          "circle-stroke-color": c.surface,
        },
      });

      // ── stations, high zoom, clustered ──
      m.addSource("stations", {
        type: "geojson",
        data: "/api/stations.geojson",
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 12,
        // The sum travels; the mean is computed from it at paint time. MapLibre has no average
        // accumulator, and summing then dividing by point_count is exactly equivalent.
        clusterProperties: {
          pm_sum: ["+", ["max", ["get", "pm25"], 0]],
          live: ["+", ["case", ["==", ["get", "quiet"], 1], 0, 1]],
        },
      });

      const clusterMean: ExpressionSpecification = [
        "case",
        ["==", ["get", "live"], 0],
        -1,
        ["/", ["get", "pm_sum"], ["max", ["get", "live"], 1]],
      ];

      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "stations",
        minzoom: CITY_ZOOM_MAX,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "point_count"],
            2, 11,
            20, 18,
            120, 26,
          ],
          "circle-color": [
            "step", clusterMean,
            c.quiet,
            0, c.excellent,
            10, c.good,
            20, c.fair,
            35, c.poor,
            55, c.bad,
          ],
          "circle-opacity": 0.75,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": c.surface,
        },
      });

      // The cluster's size is its radius, and its count appears in the panel when you click it.
      // A ring inside the disc reads as "there is more than one thing here" without any type.
      m.addLayer({
        id: "cluster-ring",
        type: "circle",
        source: "stations",
        minzoom: CITY_ZOOM_MAX,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "point_count"],
            2, 5,
            20, 8,
            120, 11,
          ],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 1.2,
          "circle-stroke-color": c.surface,
          "circle-opacity": 0,
        },
      });

      m.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        minzoom: CITY_ZOOM_MAX,
        filter: ["!", ["has", "point_count"]],
        paint: {
          // Radius is recency: a device that reported a minute ago is a solid dot, one that has
          // been silent for two hours has shrunk to a ring.
          "circle-radius": [
            "interpolate", ["linear"], ["get", "age"],
            0, 7,
            60, 5.5,
            120, 4,
          ],
          // Gone quiet → hollow. The ring stays; the fill leaves.
          "circle-color": ["case", ["==", ["get", "quiet"], 1], "rgba(0,0,0,0)", step("pm25")],
          "circle-stroke-width": 1.6,
          "circle-stroke-color": [
            "case", ["==", ["get", "quiet"], 1], c.quiet, c.surface,
          ],
          "circle-opacity": 0.95,
        },
      });

      setReady(true);
    });

    // ── interaction ──
    const openCluster = (e: MapMouseEvent) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      if (!f) return;
      const src = m.getSource("stations") as GeoJSONSource;
      src.getClusterExpansionZoom(f.properties!.cluster_id as number).then((z) => {
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z });
      });
    };
    m.on("click", "clusters", openCluster);

    m.on("click", "stations", (e) => {
      const f = e.features?.[0];
      if (f) setSelected(fromStation(f));
    });
    m.on("click", "cities", (e) => {
      const f = e.features?.[0];
      if (f) setSelected(fromCity(f));
    });

    for (const layer of ["stations", "cities", "clusters"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    return () => {
      m.remove();
      map.current = null;
    };
  }, [lat, lon, zoom]);

  // The theme toggle repaints the tokens; the map has already read them into its style, so it has
  // to be told. Without this the map keeps its light palette on a dark page — the exact failure
  // CLAUDE.md warns about, one layer further out.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const m = map.current;
      if (!m || !m.isStyleLoaded()) return;
      const c = bandColours();
      m.setPaintProperty("bg", "background-color", c.ground);
      m.setPaintProperty("graticule", "line-color", c.lineSoft);
      for (const id of ["cities", "clusters", "cluster-ring", "stations"]) {
        if (m.getLayer(id)) m.setPaintProperty(id, "circle-stroke-color", c.surface);
      }
      if (m.getLayer("cluster-ring")) m.setPaintProperty("cluster-ring", "circle-stroke-color", c.surface);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mapview">
      <div ref={holder} style={{ position: "absolute", inset: 0 }} />

      <div className="legend">
        <span className="eyebrow" style={{ marginRight: 2 }}>PM2.5</span>
        <span className="lg"><i className="scale-excellent" />0–10</span>
        <span className="lg"><i className="scale-good" />10–20</span>
        <span className="lg"><i className="scale-fair" />20–35</span>
        <span className="lg"><i className="scale-poor" />35–55</span>
        <span className="lg"><i className="scale-bad" />55+</span>
        <span className="lg" style={{ marginLeft: 6 }}><i className="ring" />quiet 2 h</span>
      </div>

      {selected && (
        <div className="peek">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="eyebrow">
              {selected.kind === "city" ? selected.name : `Station ${selected.id}`}
            </span>
            <span
              className={`chip fg-${selected.quiet ? "quiet" : pmBand(selected.pm25)}`}
              style={{ fontSize: 10 }}
            >
              <span className="dot" />
              {selected.quiet ? "quiet" : "live"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 6 }}>
            <span
              className={`num fg-${selected.quiet ? "quiet" : pmBand(selected.pm25)}`}
              style={{ fontSize: 30, lineHeight: 1 }}
            >
              {selected.pm25 >= 0 ? selected.pm25.toFixed(1) : "—"}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>µg/m³ PM2.5</span>
          </div>
          {selected.path && (
            <a
              href={selected.path}
              style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8, display: "inline-block" }}
            >
              Open {selected.kind === "city" ? selected.name : "station"} →
            </a>
          )}
        </div>
      )}

      {!ready && (
        <div className="eyebrow" style={{ position: "absolute", left: 12, bottom: 12 }}>
          {failed ? `Map failed: ${failed}` : "Loading sensors…"}
        </div>
      )}
    </div>
  );
}

function fromStation(f: MapGeoJSONFeature): Selected {
  const p = f.properties ?? {};
  return {
    kind: "station",
    id: Number(p.id),
    pm25: Number(p.pm25),
    quiet: Number(p.quiet) === 1,
    path: undefined,
  };
}

function fromCity(f: MapGeoJSONFeature): Selected {
  const p = f.properties ?? {};
  return {
    kind: "city",
    id: Number(p.id),
    name: String(p.name),
    path: String(p.path),
    pm25: Number(p.pm25),
    quiet: Number(p.pm25) < 0,
  };
}
