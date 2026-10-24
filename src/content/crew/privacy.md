# Crew Air — Privacy Policy

**Last updated:** 2026-10-24 · **Effective:** 2026-10-24
**Applies to:** the Crew Air iOS app (`co.superduperai.crewair`) and airsignal.app/crew
**Operator:** SuperDuperAI · privacy questions: info@superduperai.co

Crew Air works without an account. We never ask for your name, phone number or email, we run no
analytics, ads or trackers, and we do not sell or share personal information.

## What we collect, and why

| What | When | Why | Kept |
|---|---|---|---|
| **Place you plan for** (a town name, or coordinates if you tap "Use my location") | every plan | to fetch the forecast for that place | not stored with you; forecasts are cached by place for about 10 minutes |
| **A report** you send: its kind (smoke, symptoms, no N95s, no shade or water…), an optional note up to 280 characters, the time | when you press Send | so the crew lead sees it and can act; §5141.1 requires employers to encourage these reports | 24 months, then deleted |
| **Evidence attached to a report**: the forecast for that hour, the nearest satellite fire detection, the nearest air monitor reading | with every report | so a report shows what the air data said at that moment | with the report |
| **Where the report was made**, only if you allow location: coordinates rounded to 3 decimals (about 100 m), their accuracy, and which way the camera faced | with a report or a sky check | to place the report on the site and tell whether you faced the fire | with the report |
| **A sky photo** you check | when you press Check | to ask a vision model whether it shows smoke | **not stored by us** (see below) |
| **A rate-limit code**: a one-way hash of your IP address and the date | with a report | to stop one device flooding a site (10 reports per 10 minutes) | erased after 2 days; never shown to anyone |

Notes you type are free text. Please do not write names or phone numbers in them; anyone who opens the
same site's page can read the reports for that day.

## Sky photos

Before a photo leaves the phone, the app paints over every face it detects and, for camera shots, cuts
the frame down to the sky. The photo then passes through our server once to **TypeSafe** (the Jev
model), which returns probabilities (smoke, haze, visibility). We do not save the photo. TypeSafe
processes it under its own policy: https://typesafe.ai/legal/privacy-policy. On the website the photo
is shrunk in your browser and handled the same way.

## Location

The app uses your location on the phone to plan for where you are and to point labels in the camera
view at the right direction. It is sent to us only inside a report, a sky check or a plan request, and
reports keep it rounded to about 100 m. On the website, location is used only when you tick "Add where I
am" or press "Use my location".

## Who else is involved

- **Cloudflare** hosts the service and its database (D1). Like any web host it processes IP addresses
  to deliver pages: https://www.cloudflare.com/privacypolicy/
- **TypeSafe** analyses sky photos (above).
- **Open-Meteo** receives the place you search or plan for (no IP from you; our server asks):
  https://open-meteo.com/en/terms
- NASA FIRMS, AirNow and EPA data are fetched by our server; nothing about you is sent to them.

## Public data we publish

We may publish counts of reports and exposure by county and week, with no notes, coordinates or times
finer than a day, so researchers and agencies can see where the rules are not being followed.

## Your rights (California and elsewhere)

You can ask us to show or delete a report: email info@superduperai.co with the report number shown
after you send it (and the site and day). Because we hold no names or accounts, that number is how we
find it. We do not sell or share personal information, so there is nothing to opt out of. We will not
treat you differently for asking. California law (Labor Code §6310) protects workers who report safety
problems; Crew Air never sends a report to anyone outside the site's page unless you choose to forward it.

## Children

Crew Air is for workers and employers, not for children under 13.

## Changes

If what we collect changes, this page changes first, with a new date at the top.
