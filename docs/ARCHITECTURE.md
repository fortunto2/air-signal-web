# Architecture

## Module boundaries

```
cli/main.ts ──────────► data/stations.json ──────────► src/pages/*
   (build-time logic)      (committed page list)          (rendering)
                                                              │
                                                              ▼
                                                     src/components/*.tsx
                                                        (islands, live data)
```

Dependencies point one way. `cli/` knows nothing about Astro or React; pages read the index and
render; islands fetch live values in the browser. Nothing in `src/pages/` calls an upstream at build
time except through `cli/`.

## Why static

| Concern | Where it lives | Why |
|---|---|---|
| Page list | `data/stations.json`, committed | Reproducible builds; upstream outage can't delete pages |
| Live readings | Browser islands | Both upstreams send `access-control-allow-origin: *` |
| Comfort maths | `airq-core` WASM | Same Rust core as the CLI and the desktop app — one source of truth |
| NASA FIRMS | `functions/api/fire.ts` | The only call needing a server-side key |

## Rules

1. **One source of truth for identity.** Origin, brand, signal list, band thresholds and URL shapes
   live in `src/lib/site.ts`. A second definition anywhere is a bug.
2. **Bands are shared.** `comfortBand()` and `pmBand()` return the same vocabulary, so a colour never
   means two things on one screen.
3. **Validation at the boundary.** Upstream JSON is narrowed in `cli/main.ts` (or in the island that
   fetches it) — never trusted deeper in. Readings ≤ 0 or > 500 µg/m³ are a broken sensor, not
   clean or catastrophic air, and are dropped at that boundary.
4. **HTML carries the answer.** Anything a crawler needs — headline, verdict sentence, the fourteen
   readings, JSON-LD — is server-rendered at build. Islands may only *update* what is already there.
5. **Tokens, not hexes.** Components style through CSS variables. Theme changes happen in
   `src/styles/tokens.css` and nowhere else.

## Open decisions

Tracked in `docs/prd.md` §10: React vs Preact islands, map tile source, and where the 30-day history
lives (R2 / D1 / committed JSON).
