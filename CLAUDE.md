# CLAUDE.md — Air Signal (airsignal.app)

Live air quality and outdoor comfort, as a static site. This file is a map, not a manual — details
live in `docs/`.

## What it is

Fourteen environmental signals from `airq-core` (Rust/WASM) collapsed into one comfort score, plus a
map of the community sensors the score was computed from. Three page types: map, city, station.

The product's argument, and the thing that must survive every refactor: **colour belongs to the
data.** The chrome is near-neutral so the only saturated pixels on a page are measurements.

## Stack

- Astro 6, `output: "static"`, `trailingSlash: "always"`
- React islands (`@astrojs/react`) — live readings only
- Tailwind 4 via `@tailwindcss/vite`, tokens in `src/styles/tokens.css`
- `airq-core` WASM (from `~/startups/active/airq/airq-core`)
- Cloudflare Pages · pnpm · Node ≥ 22.12

## Commands

`make help` lists everything. The ones that matter:

```bash
make dev           # :4321
make stations      # rebuild data/stations.json, then commit it
make integration   # pipeline against live upstreams, no browser
make build         # verifies the station index, then builds
make deploy        # Cloudflare Pages
```

## Architecture

```
cli/main.ts        every deterministic thing the site does, runnable without the site
data/stations.json the page list — committed, not fetched at build (see below)
src/lib/site.ts    origin, brand, the 14 signals, bands, URL shapes. Nothing else hardcodes them
src/styles/        design tokens; components never hardcode a hex
src/pages/         index, map, [country]/[city], [country]/[city]/station-[id]
functions/         one Pages Function: /api/fire (NASA FIRMS needs a server-side key)
```

**No server.** Both upstreams send `access-control-allow-origin: *`, so live readings are fetched
from the browser. The Next version's six API routes existed because that is how one writes Next, not
because a server was required.

**The station index is committed on purpose.** A build that fetches its own page list ships half a
site when the upstream has a bad minute; a committed index makes the page list a reviewable diff.

**Every page ships its readings in HTML**, then replaces them on hydration. A crawler and a cold
visitor must never see an empty shell — that failure is the entire reason this rewrite exists.

## SEO — the gate

Station pages are indexed only if the station reported today **and** has ≥ 30 days of history.
Everything below the bar stays out of `sitemap.xml` and canonicals to its city. Sensor.Community has
tens of thousands of devices; publishing all of them would bury a few hundred real pages under a few
thousand empty ones.

## Do

- Read `docs/prd.md` before changing what a page is for
- Add a colour by adding a token, never a hex in a component
- Put deterministic logic in `cli/` first, then call it from a page — that is what keeps
  `make integration` honest
- Keep numbers in `.num` (mono, tabular figures) wherever they sit in a column

## Don't

- Don't add a server adapter to make one fetch easier — check CORS first
- Don't publish a station page that fails the gate
- Don't restyle inside `@media (prefers-color-scheme: dark)` — redefine the token, or the theme
  toggle silently stops working
- Don't hardcode `airsignal.app` anywhere but `src/lib/site.ts`
