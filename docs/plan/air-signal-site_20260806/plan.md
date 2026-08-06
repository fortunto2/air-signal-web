# Implementation Plan: Air Signal — map, city and station pages, SEO surface

**Track ID:** air-signal-site_20260806
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-06
**Status:** [ ] Not Started

## Overview

Build outward from the data: make the index know what a city is, then render the three page types
against it, then make them findable, then ship. Each phase leaves the site deployable.

## Phase 1: The index knows about places

The station index currently has coordinates and a country code. Pages need cities.

### Tasks
- [ ] Task 1.1: Load `airq-core` WASM in Node inside `cli/main.ts` — `wasm_search_cities`,
      `wasm_major_cities`, `wasm_list_countries`. Build it first with `wasm-pack` from
      `~/startups/active/airq/airq-core`; vendor the output to `src/wasm/`.
- [ ] Task 1.2: Assign each station its nearest city in `buildStations()` (haversine against the
      cities database), filling the `city` field the scaffold left `null`.
- [ ] Task 1.3: Emit `data/cities.json` alongside the stations — one entry per city that gets a page
      (top-N by population, plus every city with ≥ 1 station), with its station ids.
- [ ] Task 1.4: Wire `cli/main.ts comfort <lat> <lon>` to the WASM signal functions so the fourteen
      readings are computable without a browser.

### Verification
- [ ] `pnpm stations` fills `city` for > 95 % of stations; unassigned ones are logged, not silent
- [ ] `pnpm comfort 36.27 32.32` prints fourteen signals and a total
- [ ] `make integration` still passes

## Phase 2: The three pages

Render the mockup. Every page ships its answer in HTML; islands only update it.

### Tasks
- [ ] Task 2.1: `src/components/Spectrum.tsx` — the fourteen-bar identity mark, rendered server-side
      from build-time values, hydrating for live ones. Reuse the mockup's markup and tokens.
- [ ] Task 2.2: `src/pages/[country]/[city]/index.astro` — `getStaticPaths` over `data/cities.json`;
      verdict sentence naming the signal that costs the most points; thirty-day chart; the stations
      it was computed from.
- [ ] Task 2.3: `src/pages/[country]/[city]/station-[id].astro` — current readings, 24 h vs city
      median, hardware/uptime metadata, and the divergence block (`×N higher than modelled`).
- [ ] Task 2.4: `src/pages/map.astro` + `src/components/StationMap.tsx` — port `CityMap` from the
      Next app; pin colour = reading, radius = recency, hollow ring = quiet; left rail list;
      keyboard-reachable pins.
- [ ] Task 2.5: `functions/api/fire.ts` — the FIRMS proxy, reading `FIRMS_API_KEY` from the
      environment and never exposing it.

### Verification
- [ ] `curl` on a built city page shows the verdict sentence and all fourteen readings in the HTML
- [ ] Station pages below the gate render but carry `<link rel="canonical">` to their city
- [ ] Map is operable with keyboard only, and at 375 px width
- [ ] WASM is not requested on first paint of a city page

## Phase 3: SEO surface

The reason the rewrite is worth doing.

### Tasks
- [ ] Task 3.1: `src/pages/sitemap.xml.ts` — every city page, plus only the station pages that clear
      the gate. Log the count dropped, so silent truncation is impossible.
- [ ] Task 3.2: `src/pages/robots.txt.ts` and `src/pages/llms.txt.ts` (the `visayes` pattern),
      both deriving URLs from `SITE.origin`.
- [ ] Task 3.3: JSON-LD per page type — `Place` + `Dataset` on city and station pages, `WebSite` on
      the home page — emitted through the existing `Layout.astro` prop.
- [ ] Task 3.4: `public/og.png` and a favicon in the product's own palette (not the Next defaults).

### Verification
- [ ] `sitemap.xml` contains every city and no gated-out station
- [ ] JSON-LD validates (Rich Results Test) on one city and one station page
- [ ] `seo audit https://airsignal.app/<city>` scores clean on meta, canonical, structured data

## Phase 4: Deploy

### Tasks
- [ ] Task 4.1: Create the Cloudflare Pages project and deploy — `pnpm deploy`
      (`wrangler pages deploy dist --project-name air-signal-web`); set `FIRMS_API_KEY` in the
      dashboard.
- [ ] Task 4.2: Point `airsignal.app` (and `www`) at the project; verify HTTPS and that
      `workers.dev`-style hosts stay out of the index.
- [ ] Task 4.3: 301 `air.miralinka.com` → `airsignal.app` once city pages render, so the existing
      history transfers instead of competing as a duplicate.
- [ ] Task 4.4: Scheduled workflow (GitHub Actions) that runs `pnpm stations`, commits the diff and
      redeploys daily.

### Verification
- [ ] `curl -I https://airsignal.app/` returns 200; a city URL returns 200 with content
- [ ] `curl -I https://air.miralinka.com/` returns 301 to the new origin
- [ ] Submit the sitemap in GSC; no coverage errors after the first crawl

## Phase 5: Docs & Cleanup

### Tasks
- [ ] Task 5.1: Update `CLAUDE.md` and `.claude/skills/dev/SKILL.md` with the real commands, page
      types and gate as built; update `docs/QUALITY_SCORE.md` grades.
- [ ] Task 5.2: Update `README.md` setup steps (WASM build is a prerequisite) and close the resolved
      open questions in `docs/prd.md` §10.
- [ ] Task 5.3: Delete the scaffold placeholder in `src/pages/index.astro`; remove any component
      ported from the Next app that ended up unused.

### Verification
- [ ] `make check` clean, `make build` succeeds from a clean checkout
- [ ] CLAUDE.md matches what the code actually does

## Final Verification
- [ ] All acceptance criteria from spec.md met
- [ ] `make integration` passes
- [ ] `make build` succeeds and fails loudly on a stale index
- [ ] Documentation up to date

## Context Handoff

### Session Intent
Turn the Air Signal scaffold into a live static site whose city and station pages answer the search
query in HTML, served from `airsignal.app`.

### Key Files
- `cli/main.ts` — station index, city assignment, comfort via WASM
- `data/stations.json`, `data/cities.json` — the page list
- `src/lib/site.ts` — origin, signals, bands, URL shapes (single source of truth)
- `src/pages/[country]/[city]/` — city and station pages
- `src/pages/map.astro`, `src/components/StationMap.tsx`
- `src/pages/{sitemap.xml,robots.txt,llms.txt}.ts`
- `functions/api/fire.ts`
- Port sources: `~/startups/active/air-signal/src/components/{CityMap,ComfortPanel,HistoryChart}.tsx`

### Decisions Made
- **Static over SSR** — both upstreams allow CORS `*`; the Next API routes were a framework habit.
- **City pages gate on population, station pages on history** — measured: 9 155 stations, Turkey has
  6, so gating cities on sensors would delete the non-European map for nothing.
- **Committed station index** — reproducible builds; an upstream outage cannot delete pages.
- **React islands** — the components come from the Next app as React; Preact+compat on charts is a
  debugging tax, revisit only if the bundle becomes the LCP problem.

### Risks
- **WASM in Node** — `airq-core` is built `--target web`; loading it under Node may need a `--target
  nodejs` build or a manual `WebAssembly.instantiate`. First task of the track for a reason.
- **Map tiles** — Leaflet needs a source; the choice affects both look and cost, and is still open.
- **Thin content** — city pages backed only by model data must still read as useful, or the gate
  logic moves from stations to cities too.
- **9 155 station pages** would be a long build; the gate keeps it small, but measure build time
  before assuming.

---
_Generated by /plan. Tasks marked [~] in progress and [x] complete by /build._
