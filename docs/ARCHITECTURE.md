# Architecture

## Module boundaries

```
cli/  (Node, GitHub Actions)            src/  (Cloudflare Worker)
──────────────────────────              ─────────────────────────
upstreams.ts   every fetch              lib/db.ts      the only D1 caller
wasm.ts        airq-core, full          lib/view.ts    the view-model
places.ts      cities + assignment      lib/signals.ts readings → scores
ingest.ts      the pipeline             pages/         render
d1.ts          the only writer          components/    islands
        │                                      ▲
        └────────── D1 ───────────────────────┘
                 (write)          (read only)
```

Dependencies point one way. `cli/` knows nothing about Astro or React; the worker never writes.
`src/lib/signals.ts` is shared: the ETL runs it against the full WASM build, the browser island runs
the same code against the slim one, so there is no second implementation to drift.

## Why a server

The first plan was a static build, and it worked on paper — ~10 600 city pages plus ~3 900 station
pages fits under Cloudflare's 20 000-file ceiling. It stops working the moment `ru` and `tr` land
(three locales is 44 000 files), and it makes thirty days of history something the repository has to
carry. Rendering from a database costs one Worker and removes both problems.

What does **not** change is the rule the rewrite exists for: **the answer is in the HTML**. SSR
satisfies that as completely as a static file did — a crawler cannot tell the difference — and
`Cache-Control: s-maxage` in `src/middleware.ts` means the edge, not the database, answers every
request after the first.

| Concern | Where it lives | Why |
|---|---|---|
| Page list | `cities` and `stations` in D1 | No file-count ceiling; i18n does not multiply it |
| Ingest | `cli/`, under Node, in CI | The two largest inputs are 9 MB JSON documents |
| Comfort maths | `airq-core` WASM | Same Rust as the CLI and the desktop app — one source of truth |
| Live readings | Browser islands | Every upstream sends `access-control-allow-origin: *` |
| NASA FIRMS | The ingest | The only upstream with no CORS and a key |

## Rules

1. **One source of truth for identity.** Origin, brand, signal list, band thresholds and URL shapes
   live in `src/lib/site.ts`. A second definition anywhere is a bug — `paths.city()` builds a city
   URL, and nothing else may.
2. **The ETL only upserts, never deletes.** A bad minute at an upstream ages a row; it does not
   remove a page. The static version got this for free by committing its index to git, and it is the
   property most easily lost by moving to a database. `make integration` asserts it.
3. **Absent is not zero.** A signal with no reading is absent from `signals_json`, `null` in the
   database, and drawn as a hatched bar. Zero is a measurement — a renderer that cannot tell them
   apart draws a full-height red bar for a sensor that does not exist.
4. **Bands are shared.** `comfortBand()` and `pmBand()` return the same vocabulary, so a colour
   never means two things on one screen.
5. **Validation at the boundary.** Upstream JSON is narrowed in `cli/upstreams.ts` and nowhere
   deeper. Readings ≤ 0 or > 500 µg/m³ are a broken sensor, not clean or catastrophic air, and are
   dropped there.
6. **HTML carries the answer.** Headline, verdict sentence, all fourteen readings and JSON-LD are
   rendered server-side. Islands may only *update* what is already there.
7. **Tokens, not hexes.** Components style through CSS variables. Theme changes happen in
   `src/styles/tokens.css` and nowhere else — including the map, which reads the tokens off the
   document and repaints when the theme attribute changes.

## URLs

No trailing slash, anywhere. The site serves a `.md` twin of every city and a sharded `.xml`
sitemap, and a URL ending in an extension cannot also end in a slash; Astro applies one rule to
every route, so the extensionless pages are the ones that give it up. `src/pages/404.astro` 301s the
slashed form.

## Two WASM builds

`cities` (10 596 records) and `petgraph` are behind Cargo features, because neither is needed to
normalize fourteen signals. Splitting them took the browser binary from 1.42 MB to 216 KB (94 KB
gzipped). `src/wasm/node/` has the cities database and runs the ingest; `src/wasm/web/` is the maths
alone and goes to the worker and the browser. Both are committed — see `src/wasm/README.md`.

## Open decisions

- `ru` and `tr` locales — the English tree first, but nothing in the routing assumes one language.
- Whether the browser island should recompute at all now that SSR is at most ten minutes stale.
