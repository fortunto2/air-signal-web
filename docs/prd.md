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
GitHub Actions, daily ── cli/ under Node ── every upstream ── D1
                            airq-core WASM (full, with the cities database)
                                              │
Astro 6 (output: server) ── Cloudflare Worker ┘ ── airsignal.app
│
├── request      D1 → HTML with all fourteen readings and JSON-LD
│                Cache-Control: s-maxage=600 → the edge answers, not the database
│
└── browser      React islands refresh what the HTML already says:
                   data.sensor.community    CORS *  → no proxy needed
                   api.open-meteo.com       CORS *  → no proxy needed
                   airq-core WASM (216 KB)  lazily, on the comfort panel only
```

**Why a server** — and this reverses the draft, which specified a static build.

The static plan was sound arithmetic: ~10 600 city pages plus ~3 900 station pages fits under
Cloudflare's 20 000-file ceiling. It fails on the next step. `ru` and `tr` are in scope (§4), and
three locales is 44 000 files. Thirty days of history would also have to live in the repository,
growing it daily, to serve a chart.

A database removes both, and it costs one Worker. What it does **not** cost is the reason the
rewrite exists: SSR puts the same answer in the same HTML, and a crawler cannot tell the difference.
The API routes the Next version had are still gone — every upstream sends
`access-control-allow-origin: *`, so the browser talks to them directly. The one exception, NASA
FIRMS, moved into the ingest rather than becoming a proxy.

**Data freshness.** Pages carry the last ingest's numbers, at most a day old and usually less, and
the island refreshes them on hydration. The edge cache means the second visitor to a page pays
nothing.

### The station index

The list of devices decides which pages exist, and it lives in D1. The property that mattered about
committing it to git — that a bad upstream minute cannot silently delete half the site — is kept by
a rule instead of by a file: **the ETL only ever upserts**. A device that stops reporting ages; it
is never removed. `make integration` asserts the row count cannot go down.

### Two WASM builds

`airq-core` was 1.42 MB because it embeds a 10 596-entry cities database and links a graph library,
neither of which is needed to normalize fourteen signals. Both are now behind Cargo features. The
browser gets 216 KB (94 KB gzipped); the ingest gets the full build, under Node, where size is free.

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

| Page | Indexed when | Count | Title pattern |
|---|---|---|---|
| City | always | 10 596 | `Air Quality & Comfort in <City> — live PM2.5, sea, UV` |
| Station | four conditions below | 3 918 of 9 273 | `<City> — station <id> live PM2.5` |

**Two different gates, for two different reasons.**

City pages do *not* require a sensor. Open-Meteo's model covers every coordinate on Earth, so a city
page always has real numbers — the fourteen signals are computed either way, and where sensors exist
they take precedence with the model as reference. Gating cities on sensors would throw away the
entire non-European map for no gain in quality. The place list is `airq-core`'s embedded database:
10 596 cities across 156 countries, capped at 100 per country and ordered by population. (There is
no population *column* in that source, so "top-N by population" becomes "position in the list" —
stored as `rank`, and available if the gate ever needs to tighten.)

**The station gate had to be rewritten, because the one in the draft was not a gate.**

Measured against the Sensor.Community archive on 2026-08-06: "reporting today **and** ≥ 30 days of
history" passes **8 420 of 9 155 devices — 92 %**. It was expected to leave a few hundred. What was
missing is that a page needs a *place* to be about, and that the twentieth device in one city says
nothing the first eight did not. So the bar is four things:

1. it reported today;
2. it existed in the archive thirty days ago;
3. it sits within 25 km of a named city — **or** is the closest device that city has, so the lone
   sensor covering a stretch of coast keeps its page;
4. it is among the eight most complete devices in that city.

That leaves **3 918**. Below the bar a device still gets a page — its owner wants it, and rendering
costs nothing — but the page carries `noindex`, canonicals to its city, and stays out of the
sitemap.

Per page: `<h1>`, a verdict sentence containing real numbers, the fourteen readings, JSON-LD
(`Place` + `Dataset` + `BreadcrumbList`), canonical, hreflang, and a `.md` twin for agents rendered
from the same view-model as the HTML so the two cannot drift.

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

## 10. Decisions, closed

- **React islands.** `@astrojs/react`. The charts turned out not to need a library at all — the
  thirty-day line is an inline SVG path computed at render, which is both smaller than recharts by
  400 KB and, more importantly, present in the HTML a crawler receives.
- **Map: MapLibre GL over CARTO Positron.** Colour, radius and stroke are data-driven paint
  expressions, which is exactly how the design describes the pins; in Leaflet they would be nine
  thousand DOM nodes with inline styles.

  The basemap was a graticule drawn from our own tokens, on the argument that a pre-coloured raster
  would out-shout every reading. The argument was sound and answered the wrong question: a reader
  looking at a sensor wants to know *where* — which district, which side of the river — and
  meridians every ten degrees do not say. Nor did anything else, since a style with no `glyphs`
  cannot render a label and there was no text on that map at all.

  Positron and Dark Matter are OSM data rendered in near-neutral grey, built to sit under coloured
  data. They keep the rule the graticule was protecting while answering the question it could not.
  Standard OSM raster is the other reading of "OSM in the background" and is one URL away; beige
  landuse under a PM2.5 scale is what it costs.
- **History: D1.** `city_daily` for cities that have devices, `readings_daily` per device, both
  rolling. Cities without a sensor do not get a stored series — the model is a CORS-open fetch away
  in the browser, and storing a copy for ten thousand cities would be a third of a million rows a
  day for a chart nobody opened.

### Still open

- **`ru` and `tr`.** English tree first. Nothing in the routing assumes one language, and the
  file-count ceiling that made this hard is gone.
- **Whether the browser island should recompute at all**, now that SSR is at most ten minutes stale.
  It costs 94 KB gzipped and buys live-ness on a page left open; that may not be worth it.
- **Noise.** The only one of the fourteen with no upstream at all. It is absent rather than invented,
  which is correct but leaves the spectrum with a permanent gap.
