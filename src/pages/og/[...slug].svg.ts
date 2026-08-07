import type { APIRoute } from "astro";
import { getCity, getCountry, parseSignals } from "../../lib/db";
import { SIGNALS, SITE, comfortBand } from "../../lib/site";

/**
 * The share card, drawn per page.
 *
 * Every page shared the same static PNG, which meant a link to Berlin and a link to Sofia looked
 * identical in a message — the one place where the reading is the entire reason someone is sending
 * the link.
 *
 * SVG rather than a rendered PNG, and that is the whole trick: generating a raster needs a font
 * binary and a rasteriser in the Worker, several hundred kilobytes of it, to draw eleven rectangles
 * and three lines of text. Facebook, X, Slack, Telegram, Discord and iMessage all render SVG cards.
 * The cost here is a string.
 *
 * Text is drawn with the system stack rather than a webfont because an SVG served as an image
 * cannot fetch one; the shapes carry the identity anyway.
 */
export const GET: APIRoute = async ({ params }) => {
  const parts = (params.slug ?? "").split("/").filter(Boolean);

  let heading: string = SITE.name;
  let sub: string = SITE.tagline;
  let score: number | null = null;
  let scores: Partial<Record<string, number>> = {};

  if (parts.length === 2) {
    const city = await getCity(parts[0]!, parts[1]!);
    if (city) {
      heading = city.name;
      sub = `${city.country} · ${
        city.station_count > 0
          ? `${city.station_count} community sensor${city.station_count === 1 ? "" : "s"}`
          : "modelled"
      }`;
      score = city.comfort;
      scores = parseSignals(city.signals_json);
    }
  } else if (parts.length === 1) {
    const country = await getCountry(parts[0]!);
    if (country) {
      heading = country.name;
      sub = `${country.city_count.toLocaleString("en-US")} cities · ${country.station_count.toLocaleString("en-US")} sensors`;
      score = country.comfort;
    }
  }

  // The band colours, spelled out. Tokens live in CSS and an SVG served as an image has no
  // stylesheet, so this is the one place they are repeated — kept beside each other so a mismatch
  // with tokens.css is visible at a glance rather than hidden in a variable.
  const BAND: Record<string, string> = {
    excellent: "#0f8a7e",
    good: "#5b9b3e",
    fair: "#c98a1a",
    poor: "#c2551f",
    bad: "#9e2b25",
  };
  const accent = score === null ? "#5c6b73" : BAND[comfortBand(score)]!;

  // The spectrum, at card size. Absent signals are drawn as a low grey stub rather than skipped, so
  // the glyph keeps its shape and a reader who knows the site recognises it.
  const barW = 34;
  const gap = 10;
  const left = 72;
  const baseline = 500;
  const maxH = 150;
  const bars = SIGNALS.map((s, i) => {
    const v = scores[s.key];
    const h = v === undefined ? 6 : Math.max(8, (v / 100) * maxH);
    const fill = v === undefined ? "#d6dbdd" : BAND[comfortBand(v)]!;
    return `<rect x="${left + i * (barW + gap)}" y="${baseline - h}" width="${barW}" height="${h}" rx="2" fill="${fill}"/>`;
  }).join("");

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escape(heading)}">
  <rect width="1200" height="630" fill="#fbfcfc"/>
  <rect x="0" y="0" width="1200" height="6" fill="${accent}"/>
  <g font-family="ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <text x="72" y="104" font-size="26" font-weight="600" fill="#0d1114">air<tspan fill="${accent}">signal</tspan></text>
    <text x="72" y="228" font-size="86" font-weight="640" fill="#0d1114" letter-spacing="-2">${escape(heading.slice(0, 26))}</text>
    <text x="72" y="278" font-size="30" fill="#5c6b73">${escape(sub.slice(0, 60))}</text>
    ${
      // Left-anchored, deliberately. `text-anchor="end"` is the natural way to right-align this and
      // it silently vanished in one of the two renderers tested — a card that loses its number in
      // some clients is worse than one positioned by arithmetic. The score is one to three digits,
      // so the width is predictable and the x accounts for it.
      score !== null
        ? `<text x="${score >= 100 ? 878 : score >= 10 ? 928 : 978}" y="248" font-size="150" font-weight="500" fill="${accent}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${score}</text>
           <text x="880" y="320" font-size="24" fill="#5c6b73">comfort out of 100</text>`
        : ""
    }
    ${bars}
    <text x="72" y="556" font-size="22" fill="#8b979d">Fourteen environmental signals, not one index · airsignal.app</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Long, because the card changes only when the reading does and a social crawler fetches it
      // once per share. Revalidation keeps a stale card from outliving the page it advertises.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
};
