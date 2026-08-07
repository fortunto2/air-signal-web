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
  hw?: string;
  path?: string;
  pm25: number;
  quiet: boolean;
  kind: "city" | "station" | "source";
  /** Sources only: how far from the city centre. */
  km?: number;
}

/** OSM tag values are not sentences. */
const SOURCE_LABEL: Record<string, string> = {
  power_plant: "Power plant",
  works: "Factory",
  industrial: "Industrial land",
  motorway: "Motorway",
  trunk: "Major road",
};

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
 * The basemap: OpenStreetMap, rendered by CARTO as Positron.
 *
 * This replaces a graticule drawn from our own tokens. That version made a defensible argument — no
 * third-party request, no attribution obligation, nothing behind the pins to compete with them —
 * but it answered the wrong question. A reader looking at a sensor wants to know *where*: which
 * district, which side of the river, is that the ring road. Meridians every ten degrees do not say,
 * and nothing else on that map did either: a style with no `glyphs` cannot render a label, so there
 * was no text on it at all.
 *
 * Positron and Dark Matter are OSM data in near-neutral grey, built for exactly this job — sitting
 * under coloured data without arguing with it. Standard OSM tiles are the other reading of "OSM in
 * the background" and are one URL away, but beige landuse and green parks under a PM2.5 scale would
 * break the site's one rule in the most visible place available.
 */
function basemap(dark: boolean): string {
  return dark
    ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
}

/** The theme in force: the toggle's explicit choice if there is one, the OS preference otherwise. */
function isDark(): boolean {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "dark") return true;
  if (set === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Opens on the sensor-dense part of Europe, where three quarters of the network lives. */
const CENTER: [number, number] = [10.5, 50.5];
const ZOOM = 4;

/**
 * Where you end up travelling `km` from a point on the given bearing. The inverse of the haversine
 * the core already does — needed here because the wind and the plume are drawn as geometry on the
 * globe, not as an icon pinned to a corner, and a fixed pixel offset would point somewhere else at
 * every latitude.
 */
function destination(lat: number, lon: number, bearingDeg: number, km: number): [number, number] {
  const R = 6371;
  const d = km / R;
  const b = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI];
}

export interface WindArrow {
  /** Degrees the wind comes *from*, the meteorological convention. 0 is north. */
  fromDeg: number;
  kmh: number;
  label: string;
}

export interface PlumeWedge {
  /** Bearing from the city centre to the cluster of anomalous devices. */
  bearingDeg: number;
  spreadDeg: number;
  label: string;
}

/**
 * The wind and the plume, as geometry.
 *
 * This is the one thing a list of readings cannot say. `detect_event` in the Rust core already
 * works out that seven devices are reading high *and that they are all on one side of town* — the
 * page prints that as a sentence, and a sentence about a direction is a poor substitute for the
 * direction. Drawn here: the wind as an arrow through the centre, the anomaly as a wedge pointing
 * at where it is coming from. When the two line up, the reader can see the argument rather than
 * take it on faith.
 */
function overlay(
  centre: [number, number],
  spanKm: number,
  wind: WindArrow | null,
  plume: PlumeWedge | null,
): GeoJSON.FeatureCollection {
  const [lon, lat] = centre;
  const features: GeoJSON.Feature[] = [];

  if (plume) {
    // Clamped: a two-sensor event can report a spread of 4°, and a needle is not a direction.
    // Widened to at least 30° so the wedge reads as "that way, roughly" — which is the claim.
    const half = Math.max(15, Math.min(60, plume.spreadDeg / 2));
    const r = spanKm * 0.92;
    const arc: [number, number][] = [[lon, lat]];
    for (let a = -half; a <= half; a += 3) {
      arc.push(destination(lat, lon, plume.bearingDeg + a, r));
    }
    arc.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: { kind: "plume" },
      geometry: { type: "Polygon", coordinates: [arc] },
    });
  }

  if (wind) {
    // The shaft runs upwind to downwind through the centre, so it reads as air crossing the city
    // rather than as a pin stuck in it. Length carries speed, but within a third of the view at
    // most: drawn at full span the line left the frame at both ends, taking the arrowhead with it,
    // and a direction indicator whose point is off-screen indicates nothing.
    // A floor under the length: at 4 km/h a purely proportional arrow is ninety pixels of hairline
    // lost among three hundred dots, and "nearly calm" is a fact better carried by the legend's
    // number than by an indicator too small to find. Speed still stretches it, from a quarter of
    // the view to a half.
    const reach = spanKm * (0.26 + (Math.min(wind.kmh, 40) / 40) * 0.22);
    const tail = destination(lat, lon, wind.fromDeg, reach);
    const head = destination(lat, lon, wind.fromDeg + 180, reach);
    features.push({
      type: "Feature",
      properties: { kind: "wind" },
      geometry: { type: "LineString", coordinates: [tail, head] },
    });
    // A head, because a line has two ends and the reader cannot tell which way the air is going.
    const barb = reach * 0.22;
    for (const side of [140, -140]) {
      features.push({
        type: "Feature",
        properties: { kind: "wind" },
        geometry: {
          type: "LineString",
          coordinates: [head, destination(head[1], head[0], wind.fromDeg + 180 + side, barb)],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export interface Props {
  /** Opens here rather than on Europe — a city page shows its own devices. */
  centre?: [number, number];
  zoom?: number;
  /** Only fetch devices inside this box: `minLon,minLat,maxLon,maxLat`. */
  bbox?: [number, number, number, number];
  wind?: WindArrow | null;
  plume?: PlumeWedge | null;
  /** Roughly how far across the view is, in km — sets the length of the arrow and the wedge. */
  spanKm?: number;
  /** Shorter, for a map sitting inside a page rather than being the page. */
  inset?: boolean;
  /**
   * What OpenStreetMap says is upwind: factories, power plants, industrial land, major roads.
   *
   * Drawn as outlines rather than pins, and never coloured on the reading scale. A works is not a
   * measurement — putting it in the same palette as a sensor would claim we had measured it.
   */
  sources?: MapSource[];
}

export interface MapSource {
  name: string;
  kind: "power_plant" | "works" | "industrial" | "motorway" | "trunk";
  lat: number;
  lon: number;
  distanceKm: number;
}

export default function StationMap({
  centre = CENTER,
  zoom = ZOOM,
  bbox,
  wind = null,
  plume = null,
  spanKm = 18,
  inset = false,
  sources = [],
}: Props = {}) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof MlMap> | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [heat, setHeat] = useState(false);

  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = new MlMap({
      container: holder.current,
      style: basemap(isDark()),
      center: centre,
      zoom,
      // The window follows the devices. A fixed zoom is right for the world map, which opens on a
      // continent; on a city it is a guess that crops Sofia's 289 sensors or strands a village's
      // three in an empty field.
      ...(bbox ? { bounds: bbox, fitBoundsOptions: { padding: 28 } } : {}),
      attributionControl: false,
      // The basemap has labels now, and a rotated label is a label the reader has to tilt their
      // head for. Flat, and no accidental rotation from a two-finger gesture.
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.current = m;
    // A handle for debugging a map that will not draw — worth a build cycle every time a paint
    // expression is wrong, which on a map made of paint expressions is often. Dev only: in
    // production it would ship a global that keeps a removed map's 9 000 parsed features alive.
    if (import.meta.env.DEV) {
      (window as unknown as { __airsignalMap?: unknown }).__airsignalMap = m;
    }

    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        // Only ours. The Positron style declares its own OSM and CARTO credit, and adding a second
        // copy by hand printed the same two names twice across the bottom of the map.
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

    /**
     * Everything of ours that a style change destroys.
     *
     * `setStyle` replaces the whole style document — basemap, sources, layers, all of it — so the
     * theme toggle would otherwise swap Positron for Dark Matter and drop nine thousand sensors on
     * the floor. Naming the work once and re-running it is the difference between a theme switch
     * and a blank map. The palette is read here rather than captured, so the second run picks up
     * the tokens the toggle just changed.
     */
    const addDataLayers = () => {
      const c = bandColours();
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

      // ── the wind and the plume, under the pins ──
      // Added first so a device never disappears behind a wedge. The overlay is context; the
      // readings are the subject, and a wedge that hides one has inverted the page's whole rule.
      if (wind || plume) {
        m.addSource("overlay", { type: "geojson", data: overlay(centre, spanKm, wind, plume) });
        m.addLayer({
          id: "plume",
          type: "fill",
          source: "overlay",
          filter: ["==", ["get", "kind"], "plume"],
          paint: { "fill-color": c.poor, "fill-opacity": 0.13 },
        });
        m.addLayer({
          id: "plume-edge",
          type: "line",
          source: "overlay",
          filter: ["==", ["get", "kind"], "plume"],
          paint: { "line-color": c.poor, "line-width": 1, "line-opacity": 0.45 },
        });
      }

      // ── cities, low zoom ──
      // Skipped when the map is showing one city: at zoom 11 the layer is invisible anyway, and
      // fetching ten thousand aggregates to not draw them is the most expensive nothing on the site.
      if (!bbox) {
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
      }

      // ── stations, high zoom, clustered ──
      m.addSource("stations", {
        type: "geojson",
        data: bbox ? `/api/stations.geojson?bbox=${bbox.join(",")}` : "/api/stations.geojson",
        // Not clustered on a city map. Clustering exists to make 9 288 points across a continent
        // legible; inside one city it hides the thing the reader came for — Sofia's 317 devices
        // collapsed into twenty grey blobs, which is a worse picture than the list underneath.
        // Three hundred circles is nothing for MapLibre.
        cluster: !bbox,
        clusterRadius: 45,
        clusterMaxZoom: 12,
        // The sum travels; the mean is computed from it at paint time. MapLibre has no average
        // accumulator, and summing then dividing by point_count is exactly equivalent.
        clusterProperties: {
          pm_sum: ["+", ["max", ["get", "pm25"], 0]],
          live: ["+", ["case", ["==", ["get", "quiet"], 1], 0, 1]],
        },
      });

      // ── the measured heat ──
      //
      // Built from the devices themselves rather than from a dispersion model. Modelling a plume
      // needs a stack: its height, its exit velocity and temperature, and how much comes out of it.
      // None of that exists for ten thousand cities, and inventing it to draw a convincing shape
      // would be the most confident wrong thing on the site. What the sensors measured, smeared to
      // the distance between them, is a claim we can actually support.
      //
      // Hidden until asked for. The dots are the data; this is a reading of them.
      m.addLayer({
        id: "heat",
        type: "heatmap",
        source: "stations",
        layout: { visibility: "none" },
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "quiet"], 0]],
        paint: {
          // Weight is the reading against the top of the scale, so a bad sensor cannot dominate.
          "heatmap-weight": [
            "interpolate", ["linear"], ["max", ["get", "pm25"], 0],
            0, 0,
            55, 1,
          ] as ExpressionSpecification,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 1, 13, 2.4] as ExpressionSpecification,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 14, 13, 46] as ExpressionSpecification,
          "heatmap-opacity": 0.55,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, c.excellent,
            0.4, c.good,
            0.6, c.fair,
            0.8, c.poor,
            1, c.bad,
          ] as ExpressionSpecification,
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
        minzoom: bbox ? 0 : CITY_ZOOM_MAX,
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
        minzoom: bbox ? 0 : CITY_ZOOM_MAX,
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
        minzoom: bbox ? 0 : CITY_ZOOM_MAX,
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

      // ── what OSM says is upwind ──
      // Squares, hollow, in the ink colour. Deliberately not on the reading scale: this is a thing
      // that exists, not a thing measured, and colouring it like a sensor would assert otherwise.
      if (sources.length > 0) {
        m.addSource("osm-sources", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: sources.map((src) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [src.lon, src.lat] },
              properties: { name: src.name, kind: src.kind, km: src.distanceKm },
            })),
          },
        });
        m.addLayer({
          id: "sources",
          type: "circle",
          source: "osm-sources",
          paint: {
            "circle-radius": [
              "match", ["get", "kind"],
              "power_plant", 9,
              "works", 8,
              "industrial", 7,
              5,
            ] as ExpressionSpecification,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-width": 2,
            "circle-stroke-color": c.ink3,
            "circle-opacity": 0.9,
          },
        });
      }

      if (wind) {
        // A casing under the stroke, in the page's own background. Without it the arrow is an
        // accent-coloured line crossing three hundred accent-adjacent dots, and the eye cannot
        // separate them; with it the arrow reads as being on top of the map rather than in it.
        m.addLayer({
          id: "wind-casing",
          type: "line",
          source: "overlay",
          filter: ["==", ["get", "kind"], "wind"],
          paint: {
            "line-color": c.surface,
            "line-width": 6,
            "line-opacity": 0.85,
          },
        });
        m.addLayer({
          id: "wind",
          type: "line",
          source: "overlay",
          filter: ["==", ["get", "kind"], "wind"],
          paint: {
            "line-color": c.accent,
            "line-width": 2.6,
            "line-opacity": 1,
          },
        });
      }

    };

    m.on("load", () => {
      addDataLayers();
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
    m.on("click", "sources", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties ?? {};
      setSelected({
        kind: "source",
        id: 0,
        name: String(p.name),
        hw: SOURCE_LABEL[String(p.kind)] ?? String(p.kind),
        pm25: -1,
        quiet: false,
        km: Number(p.km),
      });
    });
    m.on("click", "cities", (e) => {
      const f = e.features?.[0];
      if (f) setSelected(fromCity(f));
    });

    for (const layer of ["stations", "cities", "clusters", "sources"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    /**
     * The theme toggle swaps the basemap, not just our paint.
     *
     * Before there was a basemap this only had to repaint a background and a graticule. Positron
     * and Dark Matter are two different style documents, so the switch is a `setStyle` — which
     * takes our sources and layers with it, hence the re-add on `styledata`. `once` rather than
     * `on`: `styledata` fires repeatedly as tiles arrive, and adding the layers again on each one
     * throws.
     */
    const observer = new MutationObserver(() => {
      m.setStyle(basemap(isDark()));
      m.once("styledata", () => addDataLayers());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as { __airsignalMap?: unknown }).__airsignalMap;
      }
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.getLayer("heat")) return;
    m.setLayoutProperty("heat", "visibility", heat ? "visible" : "none");
    // The dots stay, faded, so the heat reads as an interpretation of them rather than as a
    // replacement for them. A reader must always be able to see where a number came from.
    for (const id of ["stations", "clusters"]) {
      if (m.getLayer(id)) m.setPaintProperty(id, "circle-opacity", heat ? 0.35 : id === "stations" ? 0.95 : 0.75);
    }
  }, [heat, ready]);

  return (
    <div className={inset ? "mapview is-inset" : "mapview"}>
      <div ref={holder} style={{ position: "absolute", inset: 0 }} />

      <div className="maptools">
        <button
          type="button"
          className={heat ? "seg is-on" : "seg"}
          onClick={() => setHeat((v) => !v)}
          aria-pressed={heat}
        >
          heat
        </button>
      </div>

      <div className="legend">
        <span className="eyebrow" style={{ marginRight: 2 }}>PM2.5</span>
        <span className="lg"><i className="scale-excellent" />0–10</span>
        <span className="lg"><i className="scale-good" />10–20</span>
        <span className="lg"><i className="scale-fair" />20–35</span>
        <span className="lg"><i className="scale-poor" />35–55</span>
        <span className="lg"><i className="scale-bad" />55+</span>
        <span className="lg" style={{ marginLeft: 6 }}><i className="ring" />quiet 2 h</span>
        {wind && (
          <span className="lg" style={{ marginLeft: 6 }}>
            <i className="wind-key" />
            wind from {wind.label}
            {wind.kmh > 0 && ` · ${Math.round(wind.kmh)} km/h`}
          </span>
        )}
        {sources.length > 0 && (
          <span className="lg" style={{ marginLeft: 6 }}>
            <i className="src-key" />
            {sources.length} OSM sources
          </span>
        )}
        {plume && (
          <span className="lg">
            <i className="plume-key" />
            high readings {plume.label}
          </span>
        )}
      </div>

      {selected && (
        <div className="peek">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="eyebrow">
              {selected.kind === "station" ? `Station ${selected.id}` : selected.name}
            </span>
            {selected.kind !== "source" && (
              <span
                className={`chip fg-${selected.quiet ? "quiet" : pmBand(selected.pm25)}`}
                style={{ fontSize: 10 }}
              >
                <span className="dot" />
                {selected.quiet ? "quiet" : "live"}
              </span>
            )}
          </div>
          {selected.kind === "source" ? (
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 7, lineHeight: 1.5 }}>
              {selected.hw}
              {selected.km !== undefined && ` · ${selected.km} km away`}
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
                Mapped in OpenStreetMap. Nothing here is measured at this point — whether it reaches
                you depends on the wind.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 6 }}>
              <span
                className={`num fg-${selected.quiet ? "quiet" : pmBand(selected.pm25)}`}
                style={{ fontSize: 30, lineHeight: 1 }}
              >
                {selected.pm25 >= 0 ? selected.pm25.toFixed(1) : "—"}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>µg/m³ PM2.5</span>
            </div>
          )}
          {selected.kind !== "source" && (selected.name || selected.hw) && (
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4 }}>
              {[selected.name, selected.hw].filter(Boolean).join(" · ")}
            </div>
          )}
          {selected.kind === "source" ? null : selected.path ? (
            <a
              href={selected.path}
              style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8, display: "inline-block" }}
            >
              Open {selected.kind === "city" ? selected.name : "station"} →
            </a>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
              No city within reach — this device has no page
            </div>
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
    name: p.place ? String(p.place) : undefined,
    hw: p.hw ? String(p.hw).toUpperCase() : undefined,
    pm25: Number(p.pm25),
    quiet: Number(p.quiet) === 1,
    path: p.path ? String(p.path) : undefined,
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
