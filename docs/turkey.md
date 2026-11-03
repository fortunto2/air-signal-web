# Turkey (/tr)

Live since 3 Nov 2026. Crew Air under Turkey's rulebook, in Turkish, for the Antalya coast.

## Pages

| Route | What |
|---|---|
| `/tr` | Landing, the 10 towns, the rulebook printed from `core().wasm_rulebook("TR", "tr")` with its sources |
| `/tr/crew` | The planner (GET form, server-rendered), `?place=&date=&shift=` |
| `/tr/<town>` | One page per town in `src/lib/tr-places.ts`; any other slug is a 404 |
| `/api/crew?place=Gazipaşa&lang=tr` | The JSON; `lang=tr` gives Turkish action texts, default English |

hreflang: `/tr/crew` ↔ `/crew`, `/tr/<town>` ↔ `/turkey/<town>` (not Kumluca, which has no English page).
`/crew` now defaults to Antalya; California stays as the example rulebook.

## The rulebook

`airq-core/rulebooks/tr.json`. What the research found (Nov 2026), and therefore how the rules are labelled:

- **No Turkish law sets a numeric heat limit or a work-rest table** for outdoor work. 6331 (art. 4, 10, 13) gives the
  general duty, the risk assessment and the right to refuse in serious and imminent danger. The İşyeri Bina
  regulation names WBGT as optional and excludes construction sites and fields. So every heat rule is `guidance`:
  actions from the Sağlık Bakanlığı 2026 heat document (10:00–16:00, replan work-rest, shade, water), numbers from
  the NWS heat-index categories (26.7 / 32.2 / 39.4 °C), because MGM's hissedilen sıcaklık table is an image whose
  category limits we could not read.
- **The only binding number is PM10: 50 µg/m³ as a 24 h mean** (HKDYY). It binds air quality management, not the
  employer, and the rule text says so.
- **The index bands** (İyi … Tehlikeli) use PM10 breakpoints 50/100/260/400/520 from a secondary source; they match
  the regulation's PM10 alert levels. PM2.5 is not in the Turkish index and has no national limit: the smoke rules
  use the US EPA AQI 151 / 301 and say so.
- **Governor decisions** can bind, province by province. Antalya's of 10 Jun 2024 (11:00–16:00) was a request. The
  "12:00–16:00 ban" in search results is Northern Cyprus, not Turkey.
- **Spraying window** (`src/lib/spray.ts`): FAO 2001 Table 1 (3–7 km/h ideal, under 3 or over 10 no, 7–10 no
  herbicide). The Turkish regulation (RG 13.12.2025) binds the label and drift prevention, no number. No temperature
  cut-off is invented.

## Station data: skipped

havaizleme.gov.tr / sim.csb.gov.tr (the ministry's network, 8 stations in Antalya province) has no public API, no open
data feed and no published terms of use. The site's own XHR endpoints (`POST /Services/GetAirQualityStations`) exist
but did not answer from outside Turkey (timeouts from a US and a Cloudflare IP, 3 Nov 2026). Scraping them is not done.
WAQI carries those stations but its terms forbid paid use and caching; OpenAQ needs a key and showed no Turkish
ministry stations; the EEA has Turkey only historically (to 2025-12-31). Sensor.Community has no sensor within 25 km
of Antalya, Alanya or Gazipaşa. So plans in Turkey are model-only (CAMS via Open-Meteo), labelled "Yalnızca model".
To add stations: written permission from ÇŞİDB, then a `Ground` with `source: "ÇŞİDB"` (the engine already takes it).

## Open-Meteo 429

See CLAUDE.md, gotchas. A commercial key would end it: the Standard plan (1 M calls/month) is listed on
open-meteo.com/en/pricing; the price did not render in a plain fetch, check it there before buying.
