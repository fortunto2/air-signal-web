---
name: air-signal-web-dev
description: Dev workflow for Air Signal (airsignal.app) — run, build, rebuild the station index, deploy to Cloudflare Pages. Use when working on Air Signal pages, the sensor map, city or station pages, or the comfort score. Do NOT use for the legacy Next.js app in ~/startups/active/air-signal.
license: MIT
metadata:
  author: fortunto2
  version: "1.0.0"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Air Signal — dev workflow

Static Astro site: fourteen environmental signals into one comfort score, plus a map of the
community sensors behind it.

## Commands

```bash
make dev           # :4321
make check         # astro check + tsc
make stations      # rebuild data/stations.json — then COMMIT it
make integration   # pipeline against live upstreams, no browser
make build         # verifies the index, then builds
make deploy        # Cloudflare Pages
```

## Where things live

| Need | File |
|---|---|
| Origin, brand, the 14 signals, band thresholds, URL shapes | `src/lib/site.ts` |
| Colours, themes | `src/styles/tokens.css` |
| Build-time / deterministic logic | `cli/main.ts` |
| The page list | `data/stations.json` (committed) |
| Product decisions | `docs/prd.md` |
| Module rules | `docs/ARCHITECTURE.md` |

## Adding a page type

1. Decide the URL in `src/lib/site.ts` → `paths` — nothing else builds URLs.
2. `getStaticPaths` reads `data/stations.json`; never fetch an upstream at build.
3. Render the answer into HTML: headline, verdict sentence with real numbers, the readings, JSON-LD.
4. Add an island only to *update* what the HTML already says.
5. Add the route to `sitemap.xml.ts` — and if it is a station page, apply the gate.

## The gate (station pages)

Indexed only if the station reported today **and** has ≥ 30 days of history. Below the bar: out of
the sitemap, canonical to the city. This is a product rule, not a preference — see `docs/prd.md` §7.

## Gotchas

- **`data/stations.json` is committed.** Regenerating it is a reviewable diff, not a build step. A
  build that fetches its own page list ships half a site on a bad upstream minute.
- **Readings outside 0–500 µg/m³ are a broken sensor**, dropped at the boundary in `cli/main.ts`.
  Passing them through paints a pin bright red on the strength of a dying fan.
- **Never style inside the dark media query.** Redefine the token; otherwise the viewer's theme
  toggle stops working in one direction and it is invisible until someone reports it.
- **WASM is 1.4 MB.** Load it lazily and only on surfaces that compute comfort.

## Don't

- Don't add a server adapter before checking CORS — both upstreams allow `*`.
- Don't hardcode `airsignal.app` outside `src/lib/site.ts`.
- Don't touch the legacy Next app in `~/startups/active/air-signal` from here.
