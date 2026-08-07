/**
 * What each of the fourteen signals means, and where its score comes from.
 *
 * One record per signal, used in three places: the tooltip on a city page, the guide, and the
 * `.md` twin. Written once because a threshold repeated in three files is a threshold that will
 * eventually disagree with itself — and these numbers are not decoration, they are the scoring
 * curve in `airq-core`, quoted from the doc comments on each `normalize_*` function.
 *
 * `scale` is deliberately a handful of real points on the curve rather than a range. "UV is bad
 * above 8" is the kind of claim that sounds authoritative and says nothing; "UV 3 scores 86, UV 8
 * scores 23" lets a reader check the number in front of them against the sentence.
 *
 * Note on what these curves are *for*: they score comfort, not health risk. The two coincide for
 * air quality and part ways almost everywhere else — a full moon costs points because of what it
 * does to sleep, not because moonlight is dangerous.
 */
import type { SignalKey } from "./site";

export interface Explainer {
  /** One sentence: what is being measured, in plain words. */
  what: string;
  /** Why it belongs in a comfort score at all. */
  why: string;
  /** Points on the scoring curve, straight from the Rust doc comment. */
  scale: string;
  /** Its share of the total. Mirrors `define_signal_columns!` in matrix.rs. */
  weight: number;
  /** Where the number comes from. */
  source: string;
}

export const EXPLAIN: Record<SignalKey, Explainer> = {
  air: {
    what: "Fine particulate matter — PM2.5, the soot and smoke small enough to stay airborne for days.",
    why:
      "Particles under 2.5 micrometres are small enough to reach the alveoli and cross into the " +
      "bloodstream, which is why PM2.5 is the pollutant most consistently linked to heart and lung " +
      "disease. It is also the one a cheap sensor can measure honestly.",
    scale: "AQI 0 scores 100 · AQI 75 scores 50 · AQI 150 scores 5 · AQI 300 scores 0",
    weight: 0.2,
    source: "Community sensors where they exist, the atmospheric model elsewhere",
  },
  temperature: {
    what: "Air temperature two metres above the ground.",
    why:
      "The single strongest predictor of whether an hour outside is pleasant. Scored as a bell " +
      "around 23 °C rather than a threshold, because both directions are uncomfortable and neither " +
      "is a cliff.",
    scale: "23 °C scores 100 · 10 °C and 36 °C score 38 · 0 °C scores 7 · −10 °C scores 1",
    weight: 0.16,
    source: "Open-Meteo",
  },
  wind: {
    what: "Sustained wind speed at ten metres.",
    why:
      "Cuts both ways and is scored on the uncomfortable one. Wind disperses pollution — a calm " +
      "day is when particulates accumulate — but past about 25 km/h it is the thing that makes " +
      "being outside unpleasant regardless of how clean the air has become.",
    scale: "Calm scores 95 · 10 km/h scores 86 · 25 km/h scores 50 · 60 km/h scores 1",
    weight: 0.1,
    source: "Open-Meteo",
  },
  sea: {
    what: "Wave height at the nearest coastal point, with sea surface temperature alongside it.",
    why:
      "For a coastal city this is half the reason to go outside. Inland it is absent rather than " +
      "zero — a city 200 km from water is not scored on a sea it does not have.",
    scale: "Flat water scores 95 · 1 m scores 82 · 2 m scores 50 · 4 m scores 5",
    weight: 0.1,
    source: "Open-Meteo Marine",
  },
  uv: {
    what: "The UV index, the standard measure of how quickly unprotected skin burns.",
    why:
      "The signal an air-quality index cannot carry. Clean air and a UV of 9 is a day to be " +
      "outside on with a hat, and a page that says only “air quality good” has not said that.",
    scale: "UV 0 scores 97 · UV 3 scores 86 · UV 8 scores 23 · UV 11 scores 4",
    weight: 0.08,
    source: "Open-Meteo",
  },
  earthquake: {
    what: "The largest recent earthquake within reach of this location.",
    why:
      "Rare, and weighted for what it means when it is not rare. No earthquake is a reading of " +
      "100, not an absence — a quiet week is information.",
    scale: "Nothing nearby scores 100 · M3 scores 86 · M4.5 scores 50 · M6 scores 14",
    weight: 0.08,
    source: "USGS",
  },
  fire: {
    what: "Distance to the nearest active fire detection.",
    why:
      "Wildfire smoke is the fastest way for a clean city to become an unbreathable one, and it " +
      "arrives hours before the particulate count does. Distance is the early warning.",
    scale: "Fire at 0 km scores 8 · 15 km scores 23 · 30 km scores 50 · 100 km scores 100",
    weight: 0.05,
    source: "NASA FIRMS",
  },
  pollen: {
    what: "The highest pollen concentration among the tracked species.",
    why:
      "For roughly a quarter of adults this is the signal that decides the day, and it is " +
      "invisible to every air-quality index — pollen is not a pollutant, it is a plant.",
    scale: "Zero scores 95 · 20 grains/m³ scores 86 · 50 scores 50 · 100 scores 5",
    weight: 0.04,
    source: "Open-Meteo Air Quality (Europe only)",
  },
  pressure: {
    what: "Sea-level barometric pressure, and how fast it is moving.",
    why:
      "The level matters less than the change. Between 64 and 75 % of migraine sufferers report " +
      "attacks triggered by drops of more than 5 hPa, which is exactly where the penalty here is " +
      "centred — it can cost at most half the score.",
    scale: "1013 hPa scores 100 · 1003 scores 37 · 993 scores 2 · a 5 hPa/3 h swing halves it",
    weight: 0.05,
    source: "Open-Meteo",
  },
  geomagnetic: {
    what: "The planetary K-index, a 0–9 measure of geomagnetic disturbance.",
    why:
      "The most-disputed signal here, and included with its weight kept small for that reason. " +
      "Storms at Kp 5 and above have been associated with raised heart rate and lowered heart-rate " +
      "variability; below that it is a quiet sky.",
    scale: "Kp 0 scores 96 · Kp 3 scores 69 · Kp 5 scores 31 · Kp 9 scores 2",
    weight: 0.03,
    source: "NOAA Space Weather Prediction Center",
  },
  humidity: {
    what: "Relative humidity.",
    why:
      "Decides what a temperature feels like. 28 °C at 30 % is a pleasant afternoon and at 80 % it " +
      "is not, and the dry end has its own cost — a bell around 50 % rather than a ceiling.",
    scale: "50 % scores 100 · 30 % and 70 % score 55 · 20 % and 80 % score 28",
    weight: 0.04,
    source: "Open-Meteo",
  },
  daylight: {
    what: "Hours between sunrise and sunset.",
    why:
      "The slowest-moving signal on the page and the one people plan around without noticing. " +
      "Short days are the mechanism behind seasonal low mood, and they decide whether there is any " +
      "usable light after work.",
    scale: "6 h scores 12 · 8 h scores 27 · 10 h scores 50 · 14 h scores 88",
    weight: 0.02,
    source: "Computed from latitude and date",
  },
  noise: {
    what: "Ambient sound level in decibels.",
    why:
      "The signal most often missing, because almost nowhere measures it publicly. When it is " +
      "absent it is dropped from the score rather than assumed quiet.",
    scale: "40 dB scores 95 · 50 dB scores 82 · 60 dB scores 50 · 85 dB scores 2",
    weight: 0.03,
    source: "Community sensors that report it — most do not",
  },
  moon: {
    what: "The phase of the moon, from new to full.",
    why:
      "The lightest signal on the page, at two per cent, and the one that most needs its reasoning " +
      "stated: it scores sleep, not danger. A controlled study found people take about five minutes " +
      "longer to fall asleep around a full moon, sleep some twenty minutes less, and lose roughly a " +
      "third of their deep sleep. So a full moon costs points and a new moon does not.",
    scale: "New moon scores 100 · quarter scores 50 · full moon scores 0",
    weight: 0.02,
    source: "Computed from the date",
  },
};
