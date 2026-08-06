# PRD — Air Signal (airsignal.app)

**Status:** draft · **Created:** 2026-08-06 · **Stack:** astro-static
**Replaces:** the Next.js app at `~/startups/active/air-signal`, currently served from
`air.miralinka.com` on Vercel.

---

## 1. Problem

Every air-quality site answers one question — *how bad is the particulate count* — and paints the
answer in the same traffic-light green. Three things are missing from all of them:

1. **A person does not go outside for PM2.5.** They go outside into a combination of heat, wind, UV,
   pollen, sea temperature and daylight. A single AQI number cannot say "the air is clean but the UV
   will burn you in twenty minutes", which is the actually useful sentence.
2. **Community sensors lie, and nobody says so.** A cheap SDS011 indoors, next to a road, or with a
   dying fan reads several times high. Every map plots those readings at face value. `airq-core`
   already detects the disagreement (the Moscow case: 130 → 6.2 µg/m³ once the divergent sensors were
   down-weighted) — that correction is invisible to the user today.
3. **The pages that would answer the search query do not exist.** `air quality in <city>` is the
   entire demand in this niche. The current app renders city pages on the client from a hardcoded
   list of three, so a crawler receives an empty shell.

## 2. Solution

A static site where **colour belongs to the data**: near-neutral chrome, and the only saturated
pixels on the page are measurements.

Three page types, all pre-built at deploy time:

- **Map** — every reporting station, pin colour = reading, pin size = recency, hollow ring = gone
  quiet. The product's front door, not an illustration.
- **City** — comfort index 0–100 assembled from fourteen signals, the reading that drags it down
  named in a sentence, thirty-day history, the stations it was computed from.
- **Station** — one Sensor.Community device: current readings, 24 h against the city median,
  hardware and uptime metadata, and **how far it disagrees with the model** — the page no other air
  map has.

## 3. Users

| Segment | Question they arrive with |
|---|---|
| Residents of the Turkish coast (beachhead) | Is it safe to walk the kids today, is the sea warm |
| Relocators / digital nomads comparing places | Which of these three towns is actually pleasant |
| Sensor.Community operators | Is my station reading correctly, does it agree with its neighbours |
| Search traffic | "air quality in alanya", "pm2.5 antalya today" |

**Beachhead correction (measured 2026-08-06, not assumed).** The first station-index build returned
9 155 stations across 72 countries, and Turkey has **six** — one of them the author's own in
Gazipaşa. Alanya has none. The network is overwhelmingly European:

```
DE 3563 · NL 1406 · PL 636 · BG 595 · BE 367 · RU 299 · IT 262 · FR 261 · HU 232 · AT 219
```

So the beachhead splits in two, and the split is load-bearing for §7:

- **Sensor-dense Europe** (DE, NL, PL, BG) is where station pages, the map and the divergence story
  have material to work with — and where the SEO volume is.
- **The Turkish coast** stays the author's own daily use and the design's home turf, served by
  modelled data plus the handful of real stations.

## 4. Scope — V1

**In:**

- Map of stations with the four metric layers (PM2.5, PM10, temperature, comfort)
- City pages, pre-built for every city that has at least one reporting station
- Station pages, pre-built, gated on quality (see §7)
- Comfort index from fourteen signals via `airq-core` WASM
- Sensor/model divergence surfaced on both city and station pages
- 30-day history from the existing accumulation
- English first; `ru` and `tr` after the English tree is stable
- `sitemap.xml`, `robots.txt`, `llms.txt`, JSON-LD, canonical, hreflang
- PostHog (EU) + superduper-analytics

**Out of V1:** accounts, alerts/notifications, a public API, forecasts beyond what Open-Meteo
returns, adding your own sensor, mobile apps.

## 5. Architecture

```
Astro 6 (static) ─── Cloudflare Pages ─── airsignal.app
│
├── build time   getStaticPaths over the station index → city and station pages
│                airq-core WASM in Node computes what is knowable ahead of time
│
├── browser      React islands hydrate live readings:
│                  data.sensor.community    CORS *  → no proxy needed
│                  api.open-meteo.com       CORS *  → no proxy needed
│                  airq-core WASM (1.4 MB)  lazily, only where comfort is computed
│
└── one Function /api/fire — NASA FIRMS, the single call needing a server-side key
```

**Why static.** The six API routes in the Next version exist because that is how one writes Next, not
because a server is required: both upstreams send `access-control-allow-origin: *`. Removing them
removes the server. What remains is one Pages Function, exactly as `visayes.app` has one.

**Data freshness.** Pages carry the last build's numbers in HTML (so a crawler and a cold visitor see
real values) and replace them on hydration. A daily rebuild keeps the static copy from drifting.

### Station index

The list of stations is the site's spine — it decides which pages exist. Built by a script against
Sensor.Community's global feed, committed to the repo as JSON, refreshed by a scheduled workflow.
Committing it (rather than fetching at build) means a build is reproducible and an upstream outage
cannot silently delete half the site.

## 6. Design

Approved mockup: the four screens in the Air Signal design artifact. Load-bearing decisions:

- **Near-neutral chrome, blue-cast neutrals.** Colour is reserved for readings.
- **Comfort ramp, not a traffic light:** teal → olive → amber → terracotta → plum.
- **The fourteen-bar spectrum** is the identity mark. It works at hero size with labels and at 22 px
  inside a list row. Changing it changes the whole visual identity.
- **System type stack**, mono with tabular figures for all numbers. No webfont: an extra request in
  front of a page whose entire promise is that the reading is already on screen.
- Both themes are first-class.

## 7. SEO

The reason the rewrite is worth doing.

| Page | Pre-built when | Title pattern |
|---|---|---|
| City | it is in the top-N by population **or** has ≥ 1 station | `Air Quality & Comfort in <City> — live PM2.5, sea, UV` |
| Station | reporting today **and** ≥ 30 days of history | `<Neighbourhood>, <City> — station <id> live PM2.5` |

**Two different gates, for two different reasons.**

City pages do *not* require a sensor. Open-Meteo's model covers every coordinate on Earth, so a city
page always has real numbers — the fourteen signals are computed either way, and where sensors exist
they take precedence with the model as reference. Gating cities on sensors would throw away the
entire non-European map for no gain in quality.

Station pages *do* require the bar. Sensor.Community has ~9 000 live devices and many more dormant
ones; publishing a page per device would bury a few hundred pages that answer a question under a few
thousand that don't. Below the bar: out of the sitemap, canonical to the city.

Per page: `<h1>`, a verdict sentence containing real numbers, the fourteen readings, JSON-LD
(`Place` + `Dataset`), canonical, hreflang, and a `.md` twin for agents (the `visayes` middleware
pattern).

## 8. Success metrics

| Horizon | Metric | Target |
|---|---|---|
| Launch | `airsignal.app` live, `air.miralinka.com` 301s to it | done |
| +30 days | City pages indexed | ≥ 200 |
| +30 days | Search impressions (GSC) | first non-zero week |
| +90 days | Clicks/day from search | ≥ 50 |
| +90 days | Median LCP on a city page | < 1.5 s |

Kill/iterate line at +90 days: under 10 clicks/day with 200+ pages indexed means the niche is
saturated by incumbents — stop investing in content, keep the site as the author's own instrument.

## 9. Migration

1. Build the Astro site alongside; the Next app keeps serving `air.miralinka.com`.
2. Point `airsignal.app` at the new site once city pages render.
3. `air.miralinka.com` → 301 → `airsignal.app`, so the existing (small) history transfers rather
   than competing as a duplicate.
4. Retire the Vercel project and the dead `air-signal` Pages project only after the redirect holds.

## 10. Open questions

- **React vs Preact islands.** `recharts` and `react-leaflet` are React-native; `@astrojs/react`
  moves the components with almost no edits, Preact+compat saves ~30 KB and risks the charts.
  Decide before porting the map.
- **Map tiles.** Leaflet needs a tile source. MapLibre + a free vector style, or raster tiles —
  affects both look and cost.
- **History storage.** Thirty-day series currently accumulates locally. On a static site it needs a
  home: R2, D1, or committed JSON.
