# Quality Score

Grades per domain, updated at each `/review`. Garbage collection is a standing task, not a cleanup
sprint — a domain that slips a grade gets fixed before the next feature lands on top of it.

| Domain | Grade | Notes |
|---|---|---|
| ETL (`cli/`) | B | Runs end to end against live upstreams; resumable; upsert-only proven. No unit tests — the checks live in `make integration`, which needs the network |
| Comfort maths (WASM) | A | 114 Rust tests, including the Moscow merge vector and the two `SignalComfort` bugs found here. One binary, two runtimes, no JS re-derivation |
| Data model (D1) | B | Schema is small and indexed for the queries that exist. One migration so far; no rollback story |
| Pages / routing | B | Four page types render from real data; verified in the built worker, not only in dev. `/ranking` and `/how-it-works` are thin |
| Islands (live data) | C | `LiveCity` patches the server's DOM rather than owning it, which is right, but it is unproven against a slow network and has no visible failure state beyond one line |
| Map | B | 9 273 points, two zoom layers, cluster averaging, keyboard-reachable, no horizontal overflow at 375 px. Cluster counts are radius-only since dropping the glyph server |
| Design tokens | A | Ported verbatim from the approved mockup; theme toggle verified to flip every token in both directions, map included |
| SEO surface | B | Sitemap shards, robots, llms.txt, `.md` twins with `Accept` negotiation, JSON-LD on every page type. Unverified against a real crawler |
| Accessibility | C | Skip link, focus rings, `role="img"` with a summary on every spectrum, map canvas focusable. No screen-reader pass, and the map's pins are not individually reachable |
| Performance | B | Worker responses 5–50 ms locally, sitemap shard 99 ms; WASM off the critical path at 94 KB gzipped. LCP unmeasured on real hardware |
| Observability | C | `wrangler tail` and the ETL's own logs. No alert if an ingest silently stops |

Grades: **A** proven and covered · **B** works, thin coverage · **C** known gaps · **D** fix before
building on it.

## What would move the needles

- **ETL → A:** pure-function tests for the gate and the merge wiring, runnable without the network.
- **Islands → B:** a visible stale state, and a test that the page is complete with JS disabled.
- **Accessibility → B:** a keyboard path to individual sensors that does not go through the canvas.
- **Observability → B:** fail the workflow when a stage writes fewer rows than the day before.
