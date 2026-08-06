# Specification: Air Signal — map, city and station pages, SEO surface

**Track ID:** air-signal-site_20260806
**Type:** Feature
**Created:** 2026-08-06
**Status:** Draft

## Summary

Turn the scaffold into the site the mockup shows: a map of ~9 000 community stations, a city page
for every meaningful place, a station page for every device that clears the history bar, and the SEO
surface that makes those pages findable. All static — both upstreams send
`access-control-allow-origin: *`, so live values are fetched from the browser and the only server
code is one Pages Function for the NASA FIRMS key.

The rewrite exists for one measurable reason: the current Next app renders city pages on the client
from three hardcoded cities, so a crawler receives an empty shell. Every task below is in service of
"the answer is in the HTML".

## Acceptance Criteria

- [ ] `airsignal.app` serves the site from Cloudflare Pages; `air.miralinka.com` 301s to it
- [ ] The map renders every station in `data/stations.json`, coloured by reading, sized by recency,
      hollow when quiet — reachable by keyboard, and usable at 375 px
- [ ] A city page ships its verdict sentence, the fourteen readings and JSON-LD **in the HTML**
      (verified with `curl | grep`, not in a browser)
- [ ] A station page shows current readings, 24 h against the city median, hardware/uptime metadata,
      and the station's divergence from the model
- [ ] Station pages that fail the gate (reporting today **and** ≥ 30 days of history) are absent from
      `sitemap.xml` and canonical to their city
- [ ] `sitemap.xml`, `robots.txt`, `llms.txt` and `og.png` exist and reference the real origin
- [ ] `make integration` passes against live upstreams; `make build` fails loudly on a stale or
      truncated station index
- [ ] Median LCP on a city page < 1.5 s (WASM is lazy and off the critical path)

## Dependencies

- `airq-core` WASM built from `~/startups/active/airq/airq-core`
  (`wasm-pack build --target web --features wasm --no-default-features`)
- Sensor.Community (ODbL), Open-Meteo, NASA FIRMS (key)
- Cloudflare Pages project + `airsignal.app` zone (already in the account, currently no records)
- Design: the approved mockup — four screens, tokens already ported to `src/styles/tokens.css`

## Out of Scope

- Accounts, alerts, notifications, public API, adding your own sensor
- `ru` / `tr` locales — English tree first
- Retiring the Vercel deployment (happens after the redirect holds, not in this track)
- Where the 30-day history ultimately lives (R2 / D1) — this track reads what exists

## Technical Notes

- **The station index decides which pages exist.** Committed to the repo, refreshed by
  `pnpm stations`. A build that fetches its own page list ships half a site on a bad upstream minute.
- **Measured, not assumed:** 9 155 stations across 72 countries; Turkey has 6. City pages therefore
  gate on population, not sensors — Open-Meteo covers every coordinate. Station pages keep the bar.
- **Two colour vocabularies would be a bug.** `comfortBand()` and `pmBand()` in `src/lib/site.ts`
  return the same five bands so the map and the score never disagree visually.
- **Islands may only update what the HTML already says.** Anything a crawler needs is rendered at
  build time.
- Port `CityMap`, `ComfortPanel`, `HistoryChart` from `~/startups/active/air-signal/src/components/`
  — they are React and stay React (`@astrojs/react`); rewriting them for Preact is a separate call.
