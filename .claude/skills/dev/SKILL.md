---
name: air-signal-web-dev
description: Dev workflow for Air Signal (airsignal.app) — run, build, ingest data into D1, deploy to Cloudflare Workers. Use when working on Air Signal pages, the sensor map, city or station pages, the comfort score, or the ETL. Do NOT use for the legacy Next.js app in ~/startups/active/air-signal.
license: MIT
metadata:
  author: fortunto2
  version: "2.0.0"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Air Signal — dev workflow

Server-rendered Astro on a Cloudflare Worker, reading D1. Fourteen environmental signals into one
comfort score, plus a map of the community sensors behind it.

## Commands

```bash
make dev           # :4321, against the local D1
make db-init       # apply db/schema.sql locally
make seed          # load the cities database from WASM into D1 (once)
make ingest        # full ETL pass against live upstreams
make integration   # upstream shapes + the no-shrink guarantee
make check         # wrangler types + astro check
make build         # SSR build
make preview       # the built worker under wrangler dev — this is the real runtime
make deploy        # Cloudflare Workers
make wasm          # rebuild both airq-core artifacts from ../airq
```

**`make dev` is not the runtime.** The dev server differs from the worker on trailing slashes and on
`context.rewrite`. Verify anything routing-related with `make preview`.

## Where things live

| Need | File |
|---|---|
| Origin, brand, the 14 signals, band thresholds, URL shapes | `src/lib/site.ts` |
| Colours, themes | `src/styles/tokens.css` |
| Component styles from the mockup | `src/styles/components.css` |
| Every D1 query | `src/lib/db.ts` |
| The view-model behind HTML, `.md` and JSON-LD | `src/lib/view.ts` |
| readings → scores, shared by ETL and browser | `src/lib/signals.ts` |
| Every network call | `cli/upstreams.ts` |
| The pipeline | `cli/ingest.ts` |
| Data model | `db/schema.sql` |
| Product decisions | `docs/prd.md` · module rules `docs/ARCHITECTURE.md` |

## Adding a page type

1. Decide the URL in `src/lib/site.ts` → `paths`. Nothing else builds URLs.
2. Query through `src/lib/db.ts` — add a function there rather than writing SQL in the page.
3. Render the answer into HTML: headline, verdict sentence with real numbers, the readings, JSON-LD.
4. Add an island only to *update* what the HTML already says.
5. Add the route to `sitemap.xml.ts`, and if it is a station page, apply the gate.

## The gate (station pages)

Indexed only if the device reported today **and** existed in the archive thirty days ago **and**
sits within 25 km of a named city (or is that city's closest device) **and** is among the eight most
complete sensors there. Currently 3 918 of 9 273. Below the bar: `noindex`, canonical to the city,
out of the sitemap. Product rule, not preference — `docs/prd.md` §7.

## Gotchas

- **The worker never writes to D1.** Every row enters through `cli/`.
- **The ETL only upserts.** A bad upstream minute must age a row, never delete it.
- **Absent is not zero.** A missing reading is absent from `signals_json` and drawn hatched.
- **Open-Meteo prices locations × variables × days**, not requests. Keep current conditions and
  history in separate calls or the hourly limit trips in one batch.
- **Every fetch needs a timeout** — use `get()` in `cli/upstreams.ts`. `fetch` has none by default
  and a silent upstream stalls CI forever.
- **`INSERT … ON CONFLICT DO UPDATE` cannot update a column subset** on a table with NOT NULL
  columns: SQLite validates NOT NULL before it detects the conflict. Use `update()` in `cli/d1.ts`.
- **No trailing slashes.** `.md` twins and sharded `.xml` cannot carry one, so no URL does.
- **Never style inside the dark media query.** Redefine the token; otherwise the toggle stops
  working in one direction and it is invisible until someone reports it.
- **The map reads tokens off the document** and repaints on `data-theme` — a new map layer needs
  adding to that observer or it keeps the light palette on a dark page.
- **WASM: two builds.** `src/wasm/web/` (216 KB, no cities) ships to the browser; `src/wasm/node/`
  (1.45 MB, with cities) is ETL-only. Never import the node one from `src/`.

## Don't

- Don't query D1 in a loop — 50 subrequests per invocation on the free tier, and Sofia has 283 devices.
- Don't hardcode `airsignal.app` outside `src/lib/site.ts`, or build a URL outside `paths`.
- Don't swallow an upstream failure into `undefined` — log it, or a signal quietly vanishes worldwide.
- Don't touch the legacy Next app in `~/startups/active/air-signal` from here.
