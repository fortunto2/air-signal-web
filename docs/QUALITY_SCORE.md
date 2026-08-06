# Quality Score

Grades per domain, updated at each `/review`. Garbage collection is a standing task, not a cleanup
sprint — a domain that slips a grade gets fixed before the next feature lands on top of it.

| Domain | Grade | Notes |
|---|---|---|
| Station index (`cli/`) | — | Scaffolded; nearest-city assignment not wired |
| Comfort maths (WASM) | — | Not wired yet |
| Pages / routing | — | Only `index.astro` exists |
| Islands (live data) | — | None yet |
| Design tokens | B | Ported from the approved mockup; unproven against real components |
| SEO surface | — | sitemap / robots / llms.txt / JSON-LD not built |
| Accessibility | — | Map pins need keyboard reach from day one |
| Performance | — | Budget: WASM lazy, LCP < 1.5 s on a city page |

Grades: **A** proven and covered · **B** works, thin coverage · **C** known gaps · **D** fix before
building on it.
