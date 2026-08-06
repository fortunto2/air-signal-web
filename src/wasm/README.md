# Vendored `airq-core` WASM

Two builds of the same Rust crate, committed on purpose.

| Directory | Features | Size | Consumer |
|---|---|---|---|
| `node/` | `wasm,cities` | 1.45 MB | `cli/` — the ETL, run under Node in CI |
| `web/`  | `wasm`        | 216 KB (94 KB gz) | the SSR worker and the browser islands |

**Why two.** The `cities` crate embeds 10 596 city records and is the only reason the binary was
1.42 MB. Resolving a coordinate to a place name happens exactly once, in the ETL — the browser never
does it. Splitting the feature took the shipped binary down 6.6×.

**Why committed.** A build that compiles Rust from a sibling working copy is a build that only works
on one laptop. These are the artifacts; `make wasm` regenerates them when the core changes.

**Do not edit anything in `node/` or `web/`.** They are generated. The source is
`~/startups/active/airq/airq-core`, and the exports live in its `pub mod wasm`.

## Regenerating

```bash
make wasm          # rebuilds both from ../airq and copies them here
```

Then commit the diff — a change in these files is a change in how every number on the site is
computed, and it should be reviewable as such.

## Loading

`node/` is `--target nodejs`, so it is CommonJS and loads with `createRequire`:

```js
const require = createRequire(import.meta.url);
const wasm = require("../src/wasm/node/airq_core.js");
wasm.wasm_merge(JSON.stringify({ model_pm25: 130, sensor_pm25: 6.7, sensor_count: 10 }));
```

`web/` is `--target web`, so it is an ES module that needs `init()` before any call. In the worker
and in islands, pass the bytes or the URL explicitly rather than relying on `import.meta.url`.
