# Air Signal

Live air quality and outdoor comfort for 62,000 cities, at
[airsignal.app](https://airsignal.app).

Most air quality sites print one index number. A person does not go outside for PM2.5 — they go out
into a combination of heat, wind, UV, pollen, sea state and daylight, and one number cannot say
"the air is clean but the UV will burn you in twenty minutes", which is the actually useful
sentence. So this scores fourteen environmental signals and says which one is costing the points.

The part no other air map does: community sensors cost about fifty euros and read several times
high in humidity or beside a road. Where they disagree with the atmospheric model, this site says
by how much and resolves it rather than averaging. In Moscow the model said 130 µg/m³, ten devices
agreed on 6.7, and the answer is 6.2 — the average would have been 68, and 68 was never true
anywhere.

## How it is built

- **Astro 6**, `output: "server"`, on Cloudflare **Workers**
- **D1** for everything, read by the worker and written only by `cli/`
- **[airq-core](https://github.com/fortunto2/airq)** (Rust → WASM) for the scoring curves, the
  sensor/model merge and the source attribution
- **MapLibre GL** over CARTO Positron
- No tracking beyond a page counter, no ads, no account

Everything a search engine or an agent needs is in the HTML before any script runs. Every page also
answers with Markdown if you ask for it, and there is an [OpenAPI
document](https://airsignal.app/openapi.json) and an [A2A endpoint](https://airsignal.app/a2a).

```
cli/main.ts        the CLI: seed, expand-cities, ingest, backfill, cpf, integration
cli/upstreams.ts   every network call, with the response shape narrowed here and nowhere deeper
db/schema.sql      the data model
src/lib/site.ts    origin, brand, the 14 signals, bands, URL shapes
src/lib/db.ts      the only module that knows D1 exists
src/lib/signals.ts readings → scores, shared by the ETL and the browser
```

`make help` lists the commands. `CLAUDE.md` is the map of the rest, including the mistakes that
shaped it — the ones worth knowing before changing anything are in "Gotchas found the hard way".

## Licence

**AGPL-3.0.** Use it, study it, change it, run it, charge for it. If you run a modified version
somewhere other people can reach it over a network, section 13 says those people are entitled to
the source — which is why the footer of this site links to this repository, and why yours would
have to link to yours.

That obligation is the whole reason for the licence. The scoring curves and the merge were derived
from measurements volunteers give away for free, and taking that, improving it and keeping the
improvements private is the one use this is meant to prevent. Commercial use is not.

The data is not covered by the code licence and carries its own terms — Sensor.Community and
OpenStreetMap are ODbL, which is share-alike on derived databases. See [NOTICE](NOTICE).
