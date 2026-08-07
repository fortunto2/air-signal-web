/**
 * The guide.
 *
 * Fourteen signal articles and a handful of topic ones. They exist for two audiences at once and
 * the second is the reason the first gets a good answer: someone standing on a city page wondering
 * what "Geomagnetic 96" means, and someone typing "is pm2.5 dangerous" into a search box.
 *
 * The rule for every number below: it is either a published standard, cited by name, or it is the
 * scoring curve from `airq-core`, in which case it is quoted from the doc comment on the function
 * that computes it. Nothing here is a round number chosen because it reads well. If a threshold is
 * disputed — the geomagnetic one is — the article says so rather than borrowing confidence from
 * the ones that are not.
 *
 * `EXPLAIN` in explain.ts carries the short version that the tooltips use. This file carries the
 * long version, and does not repeat it: an article is composed from both.
 */
import { EXPLAIN } from "./explain";
import type { SignalKey } from "./site";

export interface Section {
  heading: string;
  /** Paragraphs. Rendered in order, no markup. */
  body: string[];
}

export interface Article {
  slug: string;
  /** The `<title>`. Written as the question a reader would type, where there is one. */
  title: string;
  /** The `<h1>`. Shorter than the title, and a statement rather than a question. */
  h1: string;
  description: string;
  /** A signal article carries its key, so the page can pull the curve and weight from EXPLAIN. */
  signal?: SignalKey;
  /** The opening paragraph, before any heading. */
  lede: string;
  sections: Section[];
  /** Questions with short answers. Rendered as FAQPage structured data too. */
  faq?: { q: string; a: string }[];
  related?: string[];
}

/**
 * The health material.
 *
 * Two standards, kept straight because they are constantly confused: the WHO air quality guideline
 * is a health target, the US EPA's AQI is a communication scale. They do not agree, and the WHO
 * value is stricter by a wide margin. A page that prints an AQI without saying so implies the EPA's
 * "Good" is the WHO's, and it is roughly twice it.
 */
const PM25: Article = {
  slug: "pm25",
  title: "What is PM2.5, and how harmful is it?",
  h1: "PM2.5",
  description:
    "Fine particulate matter explained: what PM2.5 is, why particles under 2.5 micrometres reach " +
    "the bloodstream, what the WHO and EPA thresholds are, and how to read a reading.",
  signal: "air",
  lede:
    "PM2.5 is airborne particles smaller than 2.5 micrometres across, about a thirtieth the width " +
    "of a human hair. It is the pollutant most consistently linked to early death, and the one " +
    "almost every air quality number you have seen is built on.",
  sections: [
    {
      heading: "Why the size is the whole story",
      body: [
        "The nose and throat catch most of what you breathe. Coarse dust lands there and leaves " +
          "again. Particles below about 10 micrometres get past that into the airways, and " +
          "particles below 2.5 keep going, down to the alveoli, the sacs where the lung hands " +
          "oxygen to the blood. The wall there is one cell thick because it has to be.",
        "That is why PM2.5 is treated differently from every other pollutant. It is not that it is " +
          "more toxic per gram. It is that the body has no mechanism for stopping it, and the " +
          "particles carry whatever they were made from into the bloodstream with them: metals " +
          "from brake dust, organic compounds from combustion, sulphates from power generation.",
        "The health literature attaches PM2.5 to heart attacks and strokes more strongly than to " +
          "lung disease, which surprises people. Inhaled particles cause inflammation, " +
          "inflammation acts on blood vessels, and the cardiovascular system is where the damage " +
          "shows up first.",
      ],
    },
    {
      heading: "The numbers, and which one to believe",
      body: [
        "There are two answers to “what counts as clean” and they are far apart.",
        "The World Health Organization's 2021 air quality guideline is 5 µg/m³ as an " +
          "annual average and 15 µg/m³ over 24 hours. Those are health targets: the " +
          "level below which the evidence stops showing harm. Most of Europe misses the annual " +
          "one. Most of the world misses it badly.",
        "The US EPA's Air Quality Index is a different instrument. It compresses concentration " +
          "onto a 0 to 500 scale so a forecast can say one word. Since May 2024 its “Good” " +
          "band ends at 9.0 µg/m³, tightened from 12.0 when the annual standard moved to " +
          "9.0. Even after that revision, EPA “Good” reaches nearly twice the WHO annual " +
          "guideline.",
        "So a page showing green at 8 µg/m³ is telling the truth about the AQI and " +
          "something more comfortable than the truth about your lungs. Both are worth knowing. " +
          "Neither is the other.",
      ],
    },
    {
      heading: "What a single reading can and cannot tell you",
      body: [
        "Almost all the health evidence is about long-term exposure. A single hour at 40 µg/m³ " +
          "is not an event in your life; a year averaging 40 is. The exception is smoke, where " +
          "concentrations reach several hundred and the short-term effects are immediate and " +
          "measurable.",
        "This is the honest limit of every live air quality map, including this one. A reading tells " +
          "you whether to shut the window this afternoon. The number that decides your risk is the " +
          "one you would get by averaging every reading where you live for a year, and no dashboard " +
          "shows you that.",
      ],
    },
    {
      heading: "What actually helps",
      body: [
        "Indoors, a HEPA filter removes fine particles from a room in tens of minutes, and a closed " +
          "window during a smoke event is worth more than anything else on this list. Outdoors, an " +
          "N95 or FFP2 mask is designed for exactly this particle size; a surgical mask is not.",
        "Distance from traffic matters more than most people expect. Concentrations of " +
          "traffic-derived particles fall steeply within the first hundred metres of a busy road, " +
          "so which side of a building you sleep on is a real variable.",
      ],
    },
  ],
  faq: [
    {
      q: "Is PM2.5 of 10 µg/m³ safe?",
      a:
        "It is above the WHO annual guideline of 5 µg/m³ and just into the EPA's Moderate " +
        "band, which starts at 9.1. As a one-off afternoon it is unremarkable. As an annual average " +
        "it is roughly twice what the health evidence supports.",
    },
    {
      q: "What is the difference between PM2.5 and PM10?",
      a:
        "The number is the particle diameter in micrometres, and PM10 includes PM2.5. The ratio " +
        "between them says what the pollution is made of: much more PM10 than PM2.5 means dust, " +
        "roughly equal amounts mean combustion or smoke.",
    },
    {
      q: "Does rain clear PM2.5?",
      a:
        "Some. Rain scavenges particles out of the air and readings usually fall during and after " +
        "it. Wind does more, which is why a calm day is when particulates accumulate.",
    },
  ],
  related: ["pm25-vs-pm10", "aqi", "sensor-accuracy"],
};

const RATIO: Article = {
  slug: "pm25-vs-pm10",
  title: "PM2.5 vs PM10: what the ratio tells you about the source",
  h1: "PM2.5 against PM10",
  description:
    "The ratio between coarse and fine particulate is a fingerprint. Dust, construction, traffic " +
    "and wildfire smoke each leave a different one, and two numbers you already have identify it.",
  lede:
    "Most sites print PM2.5 and PM10 as two readings and leave it there. Divided into each other " +
    "they answer a better question than either does alone: not how much is in the air, but what it " +
    "is.",
  sections: [
    {
      heading: "The fingerprint",
      body: [
        "Different sources make particles in different size distributions. Grinding, crushing and " +
          "wind erosion make coarse particles, so dust events are heavy in PM10 and comparatively " +
          "light in PM2.5. Anything that burns makes fine particles almost exclusively, so smoke " +
          "and combustion push the ratio the other way.",
        "The bands used here, from the PM10 divided by PM2.5 ratio: above 4 is a dust or sand " +
          "storm; 2.5 to 4 is construction or roadworks; 1.5 to 2.5 is ordinary mixed urban air; " +
          "0.9 to 1.5 is combustion, usually traffic or heating; below 0.9 is smoke.",
        "These come from the published source-apportionment literature rather than from our data: " +
          "Chow and colleagues on PM ratios by source type, Querol and colleagues on Saharan dust " +
          "reaching Europe with ratios above 4, Putaud and colleagues on European urban " +
          "composition.",
      ],
    },
    {
      heading: "Why it changes the advice",
      body: [
        "The same PM2.5 number means different things depending on what made it. Coarse dust at " +
          "50 µg/m³ is unpleasant and largely stopped by your upper airway. Wildfire smoke " +
          "at 50 µg/m³ is fine particulate that goes all the way down, and it is the case " +
          "where a mask is worth wearing.",
        "It also explains readings that otherwise look like sensor faults. A ratio jumping above 4 " +
          "for a day in spring is not a broken device, it is dust that has travelled a long way.",
      ],
    },
  ],
  related: ["pm25", "sensor-accuracy"],
};

const AQI: Article = {
  slug: "aqi",
  title: "What the Air Quality Index actually measures",
  h1: "The Air Quality Index",
  description:
    "AQI is a communication scale, not a measurement. What the bands mean, what the 2024 EPA " +
    "revision changed, and why this site does not lead with it.",
  lede:
    "AQI is not a unit. It is a translation, from concentrations in micrograms per cubic metre onto " +
    "a 0 to 500 scale with six coloured bands, so that a forecast can say one word instead of six " +
    "numbers.",
  sections: [
    {
      heading: "How the number is made",
      body: [
        "Each pollutant has a table of breakpoints. A concentration is placed inside its bracket " +
          "and interpolated linearly onto the matching AQI range. The reported AQI is then the " +
          "highest of the individual pollutant values, not an average, so the AQI is always the " +
          "single worst thing in the air rather than the overall state of it.",
        "The bands: 0 to 50 Good, 51 to 100 Moderate, 101 to 150 Unhealthy for Sensitive Groups, " +
          "151 to 200 Unhealthy, 201 to 300 Very Unhealthy, above 300 Hazardous.",
      ],
    },
    {
      heading: "The 2024 revision",
      body: [
        "In February 2024 the EPA lowered the annual PM2.5 standard from 12.0 to 9.0 µg/m³, " +
          "and the AQI breakpoints moved with it in May. The Good ceiling fell from 12.0 to 9.0, " +
          "and the upper bands came down harder: Hazardous now begins at 225.5 rather than 250.5.",
        "This matters when comparing readings across sites. The same 10 µg/m³ was Good " +
          "before the revision and is Moderate after it, and software written before 2024 that has " +
          "not been updated will still call it Good.",
      ],
    },
    {
      heading: "Why this site does not lead with it",
      body: [
        "AQI answers one question well and refuses every other one. It cannot say the air is clean " +
          "but the UV will burn you in twenty minutes, and it cannot say the pollen count is the " +
          "reason today feels worse than yesterday. Those are the sentences people actually want.",
        "So AQI is on every city page, because it is the number everyone else prints and refusing " +
          "to show it would be losing an argument nobody made. It is just not the headline.",
      ],
    },
  ],
  related: ["pm25", "how-comfort-is-scored"],
};

const SENSORS: Article = {
  slug: "sensor-accuracy",
  title: "How accurate are cheap air quality sensors?",
  h1: "Cheap sensors, and when to believe them",
  description:
    "Community air sensors cost about fifty euros and can read several times high. What causes it, " +
    "how a network of them beats any one of them, and how disagreement with the model is resolved.",
  lede:
    "The devices behind most of the readings on this site are optical particle counters costing " +
    "around fifty euros. They are genuinely useful and they are also wrong in specific, " +
    "predictable ways, and a map that hides the second half of that sentence is not worth reading.",
  sections: [
    {
      heading: "How they work, and where it breaks",
      body: [
        "A laser shines through a stream of air and a photodiode counts the flashes as particles " +
          "cross the beam. Size is inferred from the brightness of the flash, and mass is inferred " +
          "from the size by assuming what the particle is made of.",
        "Both inferences fail in humidity. Above roughly 70 % relative humidity, particles take on " +
          "water and swell, so the sensor sees something larger than the dry particle and reports " +
          "more mass than is there. Readings that spike at dawn and settle by mid-morning are " +
          "usually this rather than traffic.",
        "The other failure is placement. A device on a balcony above a busy street, or indoors near " +
          "a kitchen, measures its own microclimate accurately and the city not at all.",
      ],
    },
    {
      heading: "Why a network is better than a device",
      body: [
        "One sensor reading high is indistinguishable from a real event. Seven reading high, on the " +
          "same side of town, is a plume arriving. Distinguishing the two is the entire value of " +
          "having a network instead of a sensor, and it is a comparison no single device can make.",
        "That comparison is done here against the city's own devices rather than a stored baseline, " +
          "which is what lets it work in a place the site has never seen before.",
      ],
    },
    {
      heading: "When the sensors and the model disagree",
      body: [
        "Atmospheric models cover every coordinate on Earth and are smooth, regional and often " +
          "wrong about a specific street. Community sensors are local, real, and sometimes badly " +
          "wrong about everything. When they disagree the resolution is not to average them.",
        "A real case from Moscow: the model said 130 µg/m³, ten devices agreed on 6.7, and " +
          "the merged answer is 6.2. The average would have been 68, and 68 was never true " +
          "anywhere. Ten independent instruments agreeing with each other outweigh one model " +
          "disagreeing with all of them, and the divergence figure on a city page is that " +
          "disagreement, stated rather than smoothed away.",
        "Readings at or below zero and above 500 µg/m³ are dropped where they arrive. They " +
          "are a broken device, not clean or catastrophic air.",
      ],
    },
  ],
  faq: [
    {
      q: "Are community sensors better than official monitors?",
      a:
        "No, individually. A reference-grade monitor costs tens of thousands and is calibrated. " +
        "The advantage of community sensors is density: a city may have two official stations and " +
        "three hundred community ones, and questions about which neighbourhood is worse can only " +
        "be answered by the second kind.",
    },
    {
      q: "Why does my sensor read higher than the one down the road?",
      a:
        "Height, distance from traffic, and humidity, in roughly that order. A difference of a " +
        "factor of two between neighbouring devices is common and does not mean either is faulty.",
    },
  ],
  related: ["pm25", "how-comfort-is-scored"],
};


/**
 * The honest gap.
 *
 * Every number on this site comes from a particle counter or a weather model, and neither sees a
 * gas. Saying so plainly is worth more than the article would be if it pretended otherwise, and it
 * is the question people from industrial towns actually arrive with.
 */
const CHEMICALS: Article = {
  slug: "chemical-emissions",
  title: "What an air quality map does not measure",
  h1: "The gases nobody is counting",
  description:
    "PM sensors and air quality indices miss industrial gases entirely: hydrogen sulphide, " +
    "ammonia, formaldehyde, benzene. What the gap is, and the indirect signs that something is " +
    "in the air anyway.",
  lede:
    "If you live near a refinery, a chemical works or a landfill, the thing you smell is almost " +
    "certainly not what this site is measuring. That is worth saying at the top rather than " +
    "further down.",
  sections: [
    {
      heading: "What the sensors actually see",
      body: [
        "The community devices behind most readings here are optical particle counters. A laser " +
          "shines through moving air and a photodiode counts the flashes as particles cross the " +
          "beam. That mechanism detects solids and droplets. A gas molecule is far too small to " +
          "scatter light this way, so it is not that the reading is low: the instrument is not " +
          "measuring it at all.",
        "The atmospheric model has the same blind spot for a different reason. It carries ozone, " +
          "nitrogen dioxide, sulphur dioxide and carbon monoxide as regional fields, which is " +
          "useful for a city and useless for a street. Industrial emissions are point sources, and " +
          "a grid cell of tens of kilometres cannot represent one chimney.",
      ],
    },
    {
      heading: "The substances that fall through",
      body: [
        "Hydrogen sulphide, the rotten-egg smell around refineries, sewage works and paper mills. " +
          "Ammonia, from fertiliser plants and intensive livestock. Formaldehyde and other volatile " +
          "organic compounds from resin, plastics and coatings. Benzene, toluene and xylene from " +
          "petrochemicals and fuel handling. Mercaptans, added to natural gas precisely so a leak " +
          "can be smelled.",
        "Several of these are detectable by nose at concentrations far below anything that shows " +
          "on a monitor. Hydrogen sulphide is the clearest case: people notice it at a few parts " +
          "per billion, which is orders of magnitude under the level at which it becomes a health " +
          "concern. That gap is why complaints about smell and official readings so often " +
          "contradict each other, and why residents are usually right that something happened even " +
          "when the paperwork says nothing did.",
        "It also runs the other way. A smell is not proof of harm, and the substances with the " +
          "strongest odour are not always the ones that matter most. Carbon monoxide has no smell " +
          "at all.",
      ],
    },
    {
      heading: "The indirect signs that are here",
      body: [
        "Two things on this site do carry information about industrial air, and both are indirect.",
        "The first is the PM10 to PM2.5 ratio. It does not identify a gas, but it separates dust " +
          "from combustion, and a plant that is emitting gases is usually emitting particles as " +
          "well. A ratio sitting near 1 with a raised absolute level is a combustion signature.",
        "The second is agreement between neighbouring devices. When several sensors on one side of " +
          "town rise together while the rest stay flat, something arrived from that direction. The " +
          "map draws that as a wedge, and the wind arrow beside it says whether the two line up. " +
          "It cannot name the substance. It can tell you the difference between a plume and a " +
          "faulty box, which is the question most people are really asking.",
        "Mapped industrial sites and major roads are drawn on the city map for the same reason. " +
          "Nothing is measured at those points. They are there so the direction a reading came " +
          "from can be compared against what is actually upwind.",
      ],
    },
    {
      heading: "What to do if the gap matters where you live",
      body: [
        "Keep a record with times. A complaint saying “it smells” is dismissible; one saying " +
          "“14 March, 21:00 to 23:00, rotten eggs, wind from the north-west” is not, and it is the " +
          "kind of thing that becomes evidence when enough of them line up.",
        "Electrochemical sensors for specific gases exist and start around a few hundred euros per " +
          "substance. They drift, need periodic calibration, and measure one compound each, which " +
          "is why no citizen network has done for gases what Sensor.Community did for particles.",
        "Where a regulator publishes measurements, those are the ones with legal standing. This " +
          "site is not a substitute for them and does not claim to be.",
      ],
    },
  ],
  faq: [
    {
      q: "Why does my air quality app show green when I can smell chemicals?",
      a:
        "Because it is almost certainly reporting particulate matter and ozone, and neither is " +
        "what you are smelling. Most industrial gases do not appear in any consumer air quality " +
        "index, and the nose detects several of them far below the levels an instrument would.",
    },
    {
      q: "Can a cheap sensor detect gas leaks?",
      a:
        "Not a PM sensor. It counts particles by scattering light, and gas molecules are too small " +
        "to scatter it. Detecting a specific gas needs a sensor built for that gas.",
    },
  ],
  related: ["pm25-vs-pm10", "sensor-accuracy", "pm25"],
};

const SCORING: Article = {
  slug: "how-comfort-is-scored",
  title: "How the comfort score is calculated",
  h1: "How the score works",
  description:
    "Fourteen environmental signals, each normalised to 0 to 100 by a published curve, combined " +
    "with fixed weights. What each is worth and what happens when one is missing.",
  lede:
    "A person does not go outside for PM2.5. They go out into a combination of heat, wind, UV, " +
    "pollen, sea and daylight, and one air quality number cannot describe that. The score here is " +
    "an attempt at the whole thing.",
  sections: [
    {
      heading: "Two curves, fourteen times",
      body: [
        "Every signal is turned into a 0 to 100 score by one of two shapes. Signals with an ideal " +
          "value use a bell curve around it: temperature is centred on 23 °C, humidity on " +
          "50 %, pressure on 1013 hPa. Signals that are simply better low or better high use an " +
          "S-curve with a stated midpoint: wind is centred on 25 km/h, noise on 60 dB, UV on 6.",
        "The point of a curve rather than a threshold is that nothing real has a cliff in it. " +
          "24 °C is not categorically different from 23, and a score that says otherwise is " +
          "describing its own brackets rather than the weather.",
      ],
    },
    {
      heading: "The weights",
      body: [
        "Air quality is worth a fifth of the total and temperature nearly as much, because those " +
          "are the two that decide most days. Wind and sea take a tenth each. UV and earthquake " +
          "take eight per cent. The rest divide the remainder, with moon and daylight smallest at " +
          "two per cent apiece.",
        "The weights are a judgement and they are visible rather than hidden, which is the only " +
          "honest way to publish a judgement.",
      ],
    },
    {
      heading: "Missing is not zero",
      body: [
        "A signal with no reading is dropped from the denominator rather than scored zero. A city " +
          "with no noise sensor is judged on what is known about it instead of being punished for " +
          "silence, and an inland city is not scored on a sea it does not have.",
        "This sounds obvious and is the single most common bug in software of this kind. Treating " +
          "an absent reading as a measurement of zero once had this site announcing that Berlin's " +
          "sea was at 0 °C, and scoring it well for the calm water.",
      ],
    },
  ],
  related: ["pm25", "sensor-accuracy", "aqi"],
};

/**
 * One article per signal, composed from the shared explainer plus what is specific to it.
 *
 * Kept deliberately short. These are reference pages a reader arrives at from a tooltip with one
 * question, and padding them to article length to look substantial is the behaviour this site
 * exists to argue against.
 */
const SIGNAL_EXTRA: Record<SignalKey, { lede: string; sections: Section[]; faq?: Article["faq"] }> = {
  air: {
    lede: "",
    sections: [],
  },
  temperature: {
    lede:
      "Scored as a bell around 23 °C, because both directions are uncomfortable and neither " +
      "has a cliff in it.",
    sections: [
      {
        heading: "Why apparent temperature, not air temperature",
        body: [
          "The reading shown is the air temperature two metres above ground, which is the " +
            "measurement every source publishes and the one comparisons are made against. What a " +
            "day feels like is the combination of it with humidity and wind, and those are scored " +
            "separately here rather than folded into one heat-index number.",
          "Keeping them apart means the page can say which one is responsible. 28 °C scoring " +
            "poorly because humidity is at 85 % is a different afternoon from 28 °C scoring " +
            "poorly because it is 34 in the sun.",
        ],
      },
    ],
  },
  wind: {
    lede: "The only signal on the page that is good for the air and bad for the person.",
    sections: [
      {
        heading: "It cuts both ways",
        body: [
          "Wind disperses pollution. A still day is when particulates accumulate, which is why " +
            "winter smog forms under high pressure with no wind. So the wind score and the air " +
            "score often move in opposite directions, and that is not an inconsistency.",
          "It is scored on the uncomfortable direction because past about 25 km/h being outside is " +
            "unpleasant regardless of how clean the air has become.",
        ],
      },
    ],
  },
  sea: {
    lede: "Wave height and sea surface temperature, for the places where they are half the point.",
    sections: [
      {
        heading: "Absent inland, not zero",
        body: [
          "A city far from the coast has no sea reading, and the score is computed without it " +
            "rather than with a zero in it. On the spectrum that column is drawn hatched, which " +
            "means no data rather than bad data.",
        ],
      },
    ],
  },
  uv: {
    lede:
      "The clearest example of why one air quality number is not enough: clean air and a UV of 9 " +
      "is a day to be out in with a hat, and no AQI can say that.",
    sections: [
      {
        heading: "Reading the index",
        body: [
          "The UV index is built so that each point is roughly equal additional risk of burning. " +
            "Below 3 no protection is generally needed. From 3 to 7 shade and sunscreen matter " +
            "around midday. Above 8 unprotected fair skin burns in under twenty minutes.",
          "It peaks sharply around solar noon, so a daily maximum of 9 does not describe the " +
            "morning at all.",
        ],
      },
    ],
  },
  earthquake: {
    lede: "Rare, weighted for what it means when it is not rare.",
    sections: [
      {
        heading: "No earthquake is a reading",
        body: [
          "A quiet week scores 100 because it is information, not because the data is missing. " +
            "The two are stored differently here: the feed loading and finding nothing nearby is a " +
            "measurement, and the feed failing is an absence.",
        ],
      },
    ],
  },
  fire: {
    lede: "Distance to the nearest active fire detection, from satellite thermal anomalies.",
    sections: [
      {
        heading: "Why distance rather than smoke",
        body: [
          "Wildfire smoke can raise a city's PM2.5 by a factor of ten within hours, and the fire " +
            "is visible from orbit long before the particulate count moves. Distance is the early " +
            "warning that the air reading cannot give yet.",
          "Smoke also travels much further than the score's 100 km horizon suggests. A fire " +
            "hundreds of kilometres upwind can dominate a city's air, which is a case this signal " +
            "does not catch and the PM2.5 reading does.",
        ],
      },
    ],
  },
  pollen: {
    lede: "Invisible to every air quality index, because pollen is not a pollutant.",
    sections: [
      {
        heading: "Coverage is uneven",
        body: [
          "Pollen forecasting requires a species model calibrated for the region, and the upstream " +
            "used here covers Europe. Elsewhere this signal is absent rather than zero, which is " +
            "not the same as there being no pollen.",
        ],
      },
    ],
  },
  pressure: {
    lede: "The level matters less than the rate of change.",
    sections: [
      {
        heading: "The migraine threshold",
        body: [
          "Between 64 and 75 % of migraine sufferers report attacks associated with barometric " +
            "pressure drops of more than about 5 hPa. That figure is where the rapid-change " +
            "penalty here is centred, and the penalty is capped so it can cost at most half the " +
            "pressure score.",
          "Absolute pressure is scored around 1013 hPa, standard sea level. Much of the variation " +
            "in a reading is altitude rather than weather, which is worth knowing before reading " +
            "too much into a low number in a mountain city.",
        ],
      },
    ],
  },
  geomagnetic: {
    lede:
      "The most disputed signal here, kept at three per cent of the score for exactly that reason.",
    sections: [
      {
        heading: "What Kp is",
        body: [
          "The planetary K-index is a 0 to 9 measure of geomagnetic disturbance derived from " +
            "magnetometers around the world, updated every three hours. Below 3 is quiet, 3 to 5 " +
            "is unsettled, 5 and above is a storm.",
          "Storms at Kp 5 and above have been associated in the literature with raised heart rate " +
            "and reduced heart rate variability. The effect sizes are small and the field is " +
            "contested, which is the argument for including it with a small weight rather than " +
            "either excluding it or giving it the prominence some sites do.",
        ],
      },
    ],
  },
  humidity: {
    lede: "What decides whether a temperature is pleasant.",
    sections: [
      {
        heading: "Both ends have a cost",
        body: [
          "High humidity blocks evaporative cooling, which is why 28 °C at 85 % is " +
            "oppressive and at 30 % is a good afternoon. Low humidity dries airways and skin and " +
            "makes dust and pollen more irritating. Scored as a bell around 50 % rather than a " +
            "ceiling, for that reason.",
          "It also distorts the sensors. Above roughly 70 % the particles they count take on water " +
            "and read larger than they are.",
        ],
      },
    ],
  },
  daylight: {
    lede: "The slowest-moving signal on the page and the one people plan around without noticing.",
    sections: [
      {
        heading: "Why it is in a comfort score",
        body: [
          "Short days are the mechanism behind seasonal low mood, and they decide whether there " +
            "is usable light after work, which is what most people mean when they say a winter is " +
            "hard. It is computed from latitude and date rather than fetched, so it is never " +
            "missing.",
        ],
      },
    ],
  },
  noise: {
    lede: "The signal most often absent, because almost nowhere measures it publicly.",
    sections: [
      {
        heading: "Where the number comes from",
        body: [
          "Some community devices carry a sound sensor and most do not. Where one reports, the " +
            "reading is used; where none does, the signal is dropped from the score rather than " +
            "assumed quiet. A city with no noise data is not a quiet city.",
        ],
      },
    ],
  },
  moon: {
    lede: "The lightest signal here, and the one that most needs its reasoning stated.",
    sections: [
      {
        heading: "It scores sleep, not danger",
        body: [
          "A controlled sleep-laboratory study found that around a full moon people took about " +
            "five minutes longer to fall asleep, slept some twenty minutes less, and lost roughly " +
            "a third of their deep sleep, with no knowledge of the lunar phase and no light " +
            "reaching them. That is the entire basis for this signal, and it is why a full moon " +
            "costs points while a new moon does not.",
          "It is worth two per cent of the total. If that seems either too much or too little, " +
            "the weight is published so the disagreement can be specific.",
        ],
      },
    ],
  },
};

/** Display names, kept next to the articles so a heading never says "sea" in lowercase. */
const NAMES: Record<SignalKey, string> = {
  air: "Air quality",
  temperature: "Temperature",
  wind: "Wind",
  sea: "Sea and waves",
  uv: "UV index",
  earthquake: "Earthquakes",
  fire: "Fire risk",
  pollen: "Pollen",
  pressure: "Barometric pressure",
  geomagnetic: "Geomagnetic activity",
  humidity: "Humidity",
  daylight: "Daylight",
  noise: "Noise",
  moon: "Moon phase",
};

/** The signal articles, composed. */
const SIGNAL_ARTICLES: Article[] = (Object.keys(SIGNAL_EXTRA) as SignalKey[])
  // Air quality has its own article under a name people actually search for.
  .filter((key) => key !== "air")
  .map((key) => {
    const e = EXPLAIN[key];
    const extra = SIGNAL_EXTRA[key];
    return {
      slug: key,
      signal: key,
      title: `${e.what.replace(/\.$/, "")} — what it means`,
      h1: NAMES[key],
      description: `${e.what} ${e.why.slice(0, 120)}`,
      lede: extra.lede || e.why,
      sections: extra.sections,
      faq: extra.faq,
      related: ["how-comfort-is-scored", "pm25"],
    };
  });

export const ARTICLES: Article[] = [PM25, RATIO, AQI, SENSORS, CHEMICALS, SCORING, ...SIGNAL_ARTICLES];

export const BY_SLUG = new Map(ARTICLES.map((a) => [a.slug, a]));

/** `air` is the signal key but `pm25` is what people type. The tooltip links by key. */
export const SIGNAL_TO_SLUG: Record<SignalKey, string> = {
  ...(Object.fromEntries((Object.keys(NAMES) as SignalKey[]).map((k) => [k, k])) as Record<
    SignalKey,
    string
  >),
  air: "pm25",
};

export { NAMES };
