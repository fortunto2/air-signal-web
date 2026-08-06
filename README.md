# Air Signal

Live air quality and outdoor comfort for any city — [airsignal.app](https://airsignal.app)

Fourteen environmental signals (particulates, temperature, wind, sea, UV, pollen, pressure,
geomagnetic activity and more) collapsed into a single comfort score, plus a map of the community
sensors the score was computed from. Static site, Rust core compiled to WASM.

Two things it does that other air maps don't:

- **Scores the outdoors, not just the air.** "Clean air, but the UV will burn you in twenty minutes"
  is the useful sentence, and a single AQI number cannot say it.
- **Shows when a sensor disagrees with the model.** A cheap sensor indoors or beside a road reads
  several times high; the city score down-weights it and the station page says so.

## Stack

Astro 6 (static) · React islands · Tailwind 4 · `airq-core` (Rust → WASM) · Cloudflare Pages

## Setup

```bash
pnpm install
pnpm stations      # build data/stations.json, then commit it
make dev           # http://localhost:4321
```

Node ≥ 22.12, pnpm.

## Commands

```bash
make help          # all targets
make dev           # dev server
make integration   # pipeline against live upstreams, no browser
make build         # verifies the station index, then builds
make deploy        # Cloudflare Pages
```

## Data

- [Sensor.Community](https://sensor.community) — community particulate sensors (ODbL)
- [Open-Meteo](https://open-meteo.com) — weather, marine, UV, pollen
- [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) — active fire detections (needs an API key,
  proxied through a Cloudflare Function)

## Docs

- `docs/prd.md` — what this is and who it's for
- `docs/ARCHITECTURE.md` — module boundaries and the rules that keep them
- `CLAUDE.md` — the map for AI sessions

## License

MIT
