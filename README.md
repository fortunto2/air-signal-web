# Air Signal

Live air quality and outdoor comfort — [airsignal.app](https://airsignal.app).

Fourteen environmental signals collapsed into one score, plus a map of the ~9 000 community sensors
the score was computed from. The thing no other air map does: when a cheap sensor disagrees with the
atmospheric model, this one says by how much and weights it down, instead of plotting the
disagreement at face value.

## Setup

```bash
pnpm install
pnpm exec wrangler d1 create air-signal   # once; put the id in wrangler.jsonc
make db-init                              # apply db/schema.sql locally
make seed                                 # load the cities database into D1
make ingest                               # fetch everything and fill the tables (~20 min)
make dev                                  # :4321
```

No Rust toolchain is needed: both `airq-core` WASM builds are committed under `src/wasm/`. Rebuild
them with `make wasm` when the core changes — it expects the sibling checkout at
`~/startups/active/airq` (override with `AIRQ=…`).

`FIRMS_API_KEY` is optional. Without it the fire signal is absent rather than invented.

## Commands

| | |
|---|---|
| `make dev` | dev server on :4321, against the local D1 |
| `make preview` | the built worker under `wrangler dev` — **the real runtime**, verify routing here |
| `make ingest` | full ETL pass; `-- --only <stage>` for one stage, `-- --remote` for production |
| `make integration` | upstream shapes and the guarantee that a rerun cannot shrink the site |
| `make check` | `wrangler types` + `astro check` |
| `make deploy` | build and deploy to Cloudflare Workers |

## How it fits together

```
GitHub Actions, daily ── cli/ under Node ── every upstream ── D1
Cloudflare Worker ────── D1 ── HTML with all fourteen readings and JSON-LD
Browser ──────────────── islands refresh what the HTML already says
```

The worker only reads. Every row enters through `cli/`, and the ETL only upserts — a bad upstream
minute ages a device, it never deletes a page.

Details: [`docs/prd.md`](docs/prd.md) for what the product is,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module rules, `CLAUDE.md` for the map of the
repository.

## Data

- [Sensor.Community](https://sensor.community/) — community particulate sensors, ODbL
- [Open-Meteo](https://open-meteo.com/) — weather, air quality, marine
- [USGS](https://earthquake.usgs.gov/) — earthquakes · [NOAA SWPC](https://www.swpc.noaa.gov/) — geomagnetic
- The maths: [`airq-core`](https://github.com/fortunto2/airq), Rust compiled to WebAssembly

`/llms.txt` says the same thing in a form an agent can read, and any page returns Markdown if you
ask for it:

```bash
curl -H "Accept: text/markdown" https://airsignal.app/turkey/alanya
```
