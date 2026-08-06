# CLAUDE.md — Air Signal (airsignal.app)

Live air quality and outdoor comfort, server-rendered from D1 on a Cloudflare Worker. This file is a
map, not a manual — details live in `docs/`.

## What it is

Fourteen environmental signals from `airq-core` (Rust/WASM) collapsed into one comfort score, plus a
map of the community sensors the score was computed from. Four page types: home, map, city, station.

The product's argument, and the thing that must survive every refactor: **colour belongs to the
data.** The chrome is near-neutral so the only saturated pixels on a page are measurements.

## Stack

- Astro 6, `output: "server"`, `@astrojs/cloudflare`, deployed to Cloudflare **Workers**
- D1 (`air-signal`) — read by the worker, written only by `cli/`
- React islands (`@astrojs/react`) — live readings and the map
- MapLibre GL over CARTO Positron / Dark Matter — OSM data in near-neutral grey. The basemap tracks
  the theme toggle, which means a theme change is a `setStyle` and takes our layers with it
- Tailwind 4 via `@tailwindcss/vite`; tokens in `src/styles/tokens.css`, components in
  `src/styles/components.css`
- `airq-core` WASM, vendored in two builds (`src/wasm/node/`, `src/wasm/web/`)
- pnpm · Node ≥ 22.12

## Commands

`make help` lists everything. The ones that matter:

```bash
make dev           # :4321, against the local D1
make db-init       # apply db/schema.sql locally
make seed          # load the cities database into D1 (once)
make ingest        # the full ETL pass against live upstreams
make integration   # upstream shapes + the no-shrink guarantee
make build         # SSR build
make preview       # the built worker, via wrangler dev
make deploy        # Cloudflare Workers
make wasm          # rebuild both WASM artifacts from ../airq
```

## Architecture

```
cli/main.ts        the CLI: seed, ingest, comfort, integration
cli/upstreams.ts   every network call, with the response shape narrowed here and nowhere deeper
cli/ingest.ts      the pipeline: places → devices → signals → divergence → the gate
db/schema.sql      the data model
src/lib/site.ts    origin, brand, the 14 signals, bands, URL shapes. Nothing else hardcodes them
src/lib/db.ts      the only module that knows D1 exists
src/lib/view.ts    the view-model the HTML, the .md twin and the JSON-LD all render from
src/lib/signals.ts readings → scores, shared by the ETL and the browser island
src/middleware.ts  edge caching + Accept: text/markdown negotiation
```

**The worker writes cache columns, and nothing else.** Rows are created only by `cli/`, run under
Node in GitHub Actions, because the two largest inputs are 9 MB JSON documents and a 128 MB isolate
is the wrong place for them. But a city page whose readings are stale scores itself — four upstream
calls, the same WASM, a `waitUntil` write-back — so `saveCityReadings` in `src/lib/db.ts` may fill
`comfort`, `signals_json`, `readings_json` and `updated_at` on a row that already exists. That is
the entire write surface the worker has.

**Comfort is computed on demand, not for ten thousand cities a night.** Most city pages get no
traffic for months; scoring them all daily is what exhausted Open-Meteo's quota and left the site
blank. The nightly pass now warms only the ~1 300 cities that have sensors, because the home page,
the ranking and the country pages are aggregates and cannot be lazy. Everything else fills in when
someone — usually a crawler — first opens it. Cold ~700 ms, warm ~20 ms.

**The ETL only upserts.** A bad upstream minute ages a row; it never deletes one. `make integration`
asserts the row count cannot go down — that property came free when the index was a committed file
and is the thing most easily lost by moving to a database.

**Every page ships its readings in HTML**, then refreshes them on hydration. A crawler and a cold
visitor must never see an empty shell — that failure is the entire reason this rewrite exists.

## SEO — the gate

A station page is indexed only if the device reported today, existed in the Sensor.Community archive
thirty days ago, sits within 25 km of a named city (or is the closest device that city has), and is
among the eight most complete sensors there. Measured today: **3 918 of 9 273**. Everything below
the bar keeps its page but carries `noindex` and canonicals to its city.

The PRD's original bar — reported today plus thirty days of history — passed 8 420 of 9 155 when
measured against the archive. It was not a gate; these four things are.

City pages are **not** gated on sensors. Open-Meteo covers every coordinate, so a city page always
has real numbers, and gating cities on sensors would delete the entire non-European map.

## Do

- Read `docs/prd.md` before changing what a page is for
- Add a colour by adding a token, never a hex in a component
- Build URLs with `paths` from `src/lib/site.ts` — never by hand
- Put deterministic logic in `cli/` first, then read it from a page — that is what keeps
  `make integration` honest
- Keep numbers in `.num` (mono, tabular figures) wherever they sit in a column
- Treat a missing reading as absent, never as zero

## Don't

- Don't query D1 outside `src/lib/db.ts`, and don't query it in a loop — the free tier allows
  50 subrequests per invocation and Sofia has 283 devices
- Don't write to D1 from the worker
- Don't add a trailing slash to a URL — `.md` twins and sharded `.xml` cannot have one, so nothing does
- Don't restyle inside `@media (prefers-color-scheme: dark)` — redefine the token, or the theme
  toggle silently stops working
- Don't hardcode `airsignal.app` anywhere but `src/lib/site.ts`
- Don't swallow an upstream failure. Absent data must be visible in the log and on the page;
  silently returning `undefined` drops a signal from every city on Earth and nobody notices

## Gotchas found the hard way

- **Open-Meteo prices work, not requests** — locations × variables × days. A 31-day hourly series
  for 200 cities is thousands of calls and trips the hourly limit in one batch. Current conditions
  and history are separate queries for that reason.
- **`fetch` has no timeout.** An upstream that accepts a connection and says nothing stalls the pass
  forever. Everything goes through `get()` in `cli/upstreams.ts`, which sets one.
- **SQLite checks NOT NULL before conflict resolution**, so `INSERT … ON CONFLICT DO UPDATE` cannot
  update a subset of columns on a table with NOT NULL columns. Use `update()` in `cli/d1.ts`.
- **The archive listing is 4.5 MB and sometimes truncates**, which `res.text()` reports as success.
  A short answer is a broken download, not a quiet day — it is rejected.
- **`sea` is the column, `marine` is the function name.** `SignalRow::from_pairs` drops keys it does
  not recognise without saying so.
- **WebAssembly must be a deploy-time import in a Worker.** `WebAssembly.compile()` at runtime is
  refused: *Wasm code generation disallowed by embedder*. And the binary may be imported exactly one
  way across the whole project — Vite resolves `foo.wasm` and `foo.wasm?url` from a single id and
  the client build wins, leaving the worker with an asset path and `No such module`. Duplicating the
  file does not help; identical bytes hash to the same asset. The browser therefore does not load
  WASM at all: it asks `/api/comfort`.
- **MapLibre's data worker must be bundled explicitly** — `?worker&url` plus `worker: { format: "es" }`
  in the Vite config. Without it the pool starts dead, no GeoJSON ever parses, `load` never fires,
  and the only symptom is a blank map under a permanent "Loading sensors…". No error is raised.
- **Deploy with `make deploy`.** The adapter copies `wrangler.jsonc` into `dist/server/wrangler.json`
  at build time and wrangler reads *that*, so a bare `wrangler deploy` ships the previous config.
