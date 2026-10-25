# Air Signal — Privacy Policy

**Last updated:** 2026-10-25 · **Effective:** on the app's release
**Applies to:** the Air Signal iOS app (`co.superduperai.airsignal`)
**Operator:** SuperDuperAI · privacy questions: info@superduperai.co

Air Signal works without an account. We never ask for your name, phone number or email, we run no ads
or trackers, and we do not sell or share personal information. The app keeps one small usage counter
of our own, described below.

## What we collect, and why

| What | When | Why | Kept |
|---|---|---|---|
| **The place you look at**: coordinates rounded on the phone to two decimals (about 1 km) | every forecast, the map, the place name | to fetch the forecast, name the nearest town and list sensors around it | not stored with you; forecasts are cached by place for about 10 minutes |
| **A report** you send: what the air is like (smoke smell, haze, ash, dust, chemical smell, clear), how strong (1–5), the minute it was sent | when you press Send | to compare what people notice with monitors and forecasts | 24 months, then deleted |
| **Evidence sent with a report**: this hour's forecast (AQI, PM2.5), wind, the nearest satellite fire and air monitor, and your latest sky check's score if you attach it | with every report | so each report shows what the air data said when it was made | with the report |
| **Where the report was made**: your location if you allow it, otherwise the place you are looking at, rounded on the phone to two decimals (about 1 km). No heading. | with a report | to place the report and derive the air evidence for that point and hour | with the report |
| **A sky photo** you check | when you press Check | to ask a vision model whether it shows smoke | **not stored by us** (see below) |
| **A rate-limit code**: a one-way hash of your IP address and the date | with a report | to stop one device flooding the service (10 reports per 10 minutes) | erased after 2 days; never shown to anyone |

A report carries no name, account, device identifier or install code, and no photo. The rate-limit code
changes every day, so two reports from different days cannot be linked to each other through it.

Reports go to the same service as Crew Air's but into their own table; they are not shown on the Crew Air
pages for an area, and nothing is published yet (see Open data below).

## Usage counter

The app sends three events to our own counter at analytics.superduperai.co: the app was opened, a
forecast was shown, a sky check finished. Each carries the app version and an install code: a random UUID
the app makes on first launch and keeps on the phone. It is not Apple's advertising identifier or vendor
identifier, it is shared with no other app, and it is deleted with the app. No place, photo, report or
location travels with these events; sending a report is never counted. The counter runs on Cloudflare; its
code is public at https://github.com/fortunto2/superduper-analytics.

## Sky photos

Before a photo leaves the phone, the app paints over every face it detects and, for camera shots, cuts the
frame down to the sky. The photo then passes through our server once to **TypeSafe** (the Jev model), which
returns probabilities (smoke, haze, visibility). We do not save the photo, and it is never attached to a
report; only its smoke score is, if you choose. TypeSafe processes it under its own policy:
https://typesafe.ai/legal/privacy-policy.

## Location

Location is optional; the place search works without it. When allowed, the app uses it on the phone for the
forecast where you are and to point labels in the camera view the right way. What leaves the phone is
rounded to about 1 km first.

## Who else is involved

- **Apple** answers the place search (Apple Maps): the text you type goes to Apple, not to us.
- **Cloudflare** hosts the service and its database: https://www.cloudflare.com/privacypolicy/
- **TypeSafe** analyses sky photos (above).
- **Open-Meteo** receives the rounded place (our server asks, not your phone): https://open-meteo.com/en/terms
- NASA FIRMS, EPA AirNow, the National Weather Service and Sensor.Community data are fetched by our server;
  nothing about you is sent to them.

## Open data

Reports may be published later as an **anonymised open dataset, in aggregate**: counts by kind and strength
per area of at least about 10 km and per hour or coarser, next to the forecast and monitor readings, so
anyone can test how often people notice what monitors miss. No coordinates finer than the area, no exact
times, no rate-limit codes. Nothing is published yet; this page will say so before anything is.

## Your rights (California, the EU and elsewhere)

You can ask us to show or delete a report: email info@superduperai.co with the time you sent it and the
place (the app lists today's reports on your phone). Because we hold no names or accounts, those are how we
find it. We do not sell or share personal information, so there is nothing to opt out of, and we will not
treat you differently for asking.

## Children

Air Signal is a general-audience app and does not knowingly collect anything from children under 13; it
collects nothing that identifies anyone.

## Changes

If what we collect changes, this page changes first, with a new date at the top.
