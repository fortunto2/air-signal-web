import type { APIRoute } from "astro";
import { BAND_HEX } from "../lib/widget";

/**
 * The embed. One script tag, and the reading appears on someone else's page.
 *
 * The shape of the snippet is the whole design:
 *
 *   <a href="https://airsignal.app/turkey/gazipasa" data-airsignal="turkey/gazipasa">
 *     Air quality in Gazipaşa
 *   </a>
 *   <script async src="https://airsignal.app/embed.js"></script>
 *
 * An anchor, not an iframe, and that is deliberate. An iframe is the easy thing to paste and it is
 * worth nothing to us: its contents belong to a different document, so no link inside it is a link
 * to us as far as a search engine is concerned. This puts a real `<a href>` in the host page's own
 * HTML — present before the script runs, still present if the script never runs, and upgraded into
 * a live bar when it does. The widget is the reason to paste it; the link is what we get for it.
 *
 * Which is the same argument the site makes about itself: the answer is in the HTML, and the
 * script only refreshes it.
 *
 * Served from a route rather than `public/` so the band colours come from `widget.ts` — they are
 * already spelled out in three places and a fourth, hand-copied into a string, is how the map ends
 * up disagreeing with the page it links to.
 */
export const GET: APIRoute = () => {
  const script = `(function () {
  "use strict";

  // Where we were loaded from — never a hardcoded host. A staging copy of this file serves a
  // staging widget without editing anything, and the snippet on a customer's page cannot end up
  // pointing at a domain we no longer own.
  // \`currentScript\` is set for a classic async script but null inside a module or a callback, and
  // the tag is easy enough to find by name — so look it up rather than fall back to a hardcoded
  // host that would be wrong on every deployment but one.
  var tag = document.currentScript || document.querySelector('script[src*="/embed.js"]');
  var ORIGIN = tag && tag.src ? new URL(tag.src).origin : location.origin;

  var BAND = ${JSON.stringify(BAND_HEX)};
  var MOUNTED = "data-airsignal-ready";

  function css() {
    if (document.getElementById("airsignal-css")) return;
    var el = document.createElement("style");
    el.id = "airsignal-css";
    // Everything is scoped under .airsignal- and sets its own font, size and colour, because it
    // lands inside a stylesheet we have never seen. \`all: initial\` was tried and is worse: it
    // also drops inheritance the host page legitimately controls, like direction on an RTL site.
    el.textContent = [
      ".airsignal{display:inline-flex;align-items:center;gap:.6em;flex-wrap:wrap;",
      "font:inherit;font-size:.9em;line-height:1.35;text-decoration:none;color:inherit;",
      "padding:.35em .6em;border:1px solid rgba(128,128,128,.28);border-radius:.5em;vertical-align:middle}",
      ".airsignal:hover{border-color:rgba(128,128,128,.5)}",
      ".airsignal-card{display:flex;flex-direction:column;align-items:flex-start;gap:.3em;padding:.7em .85em}",
      ".airsignal-n{font-variant-numeric:tabular-nums;font-weight:600}",
      ".airsignal-dim{opacity:.62}",
      ".airsignal-place{font-weight:600}",
      ".airsignal-mark{opacity:.55;font-size:.85em;white-space:nowrap}",
      ".airsignal-row{display:flex;align-items:center;gap:.6em;flex-wrap:wrap}",
    ].join("");
    document.head.appendChild(el);
  }

  function dark(node) {
    var want = node.getAttribute("data-airsignal-theme") || "auto";
    if (want === "dark") return true;
    if (want === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function num(v, digits) {
    return typeof v === "number" ? v.toFixed(digits === undefined ? 1 : digits) : null;
  }

  function render(node, data) {
    var tone = dark(node) ? "dark" : "light";
    var card = node.getAttribute("data-airsignal-variant") === "card";
    var doc = document.createDocumentFragment();

    function span(cls, text, color) {
      var s = document.createElement("span");
      if (cls) s.className = cls;
      if (color) s.style.color = color;
      s.textContent = text;
      return s;
    }

    // Built with createElement rather than innerHTML on purpose: the payload carries a city name
    // that came from a database, and writing it into another site's DOM as markup would make our
    // JSON a script-injection vector on their page.
    var head = document.createElement("span");
    head.className = "airsignal-row";

    if (data.aqi) {
      head.appendChild(span("airsignal-n", "AQI " + data.aqi.value, BAND[data.aqi.band][tone]));
      head.appendChild(span("airsignal-dim", data.aqi.label));
    }

    var r = data.readings || {};
    var bits = [];
    if (num(r.temperature, 0) !== null) bits.push(num(r.temperature, 0) + "°C");
    if (num(r.pm25) !== null) bits.push("PM2.5 " + num(r.pm25));
    if (num(r.wave) !== null) bits.push(num(r.wave) + " m waves");
    if (bits.length) head.appendChild(span("airsignal-dim", bits.join(" · ")));

    if (data.comfort) {
      head.appendChild(
        span("airsignal-n", data.comfort.value + "/100", BAND[data.comfort.band][tone]),
      );
    }

    if (card) {
      doc.appendChild(span("airsignal-place", data.name));
      doc.appendChild(head);
      doc.appendChild(
        span(
          "airsignal-mark",
          (data.sensors > 0
            ? data.sensors + " community sensor" + (data.sensors === 1 ? "" : "s")
            : "modelled") + " · airsignal.app ↗",
        ),
      );
    } else {
      doc.appendChild(span("airsignal-place", data.name));
      doc.appendChild(head);
      doc.appendChild(span("airsignal-mark", "airsignal.app ↗"));
    }

    node.textContent = "";
    node.appendChild(doc);
    node.className = (node.className ? node.className + " " : "") + "airsignal" + (card ? " airsignal-card" : "");
    node.setAttribute(MOUNTED, "1");
  }

  function mount(node) {
    if (node.hasAttribute(MOUNTED)) return;
    var place = node.getAttribute("data-airsignal");
    var query = place && place.indexOf(",") === -1
      ? "place=" + encodeURIComponent(place)
      : place
        ? "lat=" + encodeURIComponent(place.split(",")[0].trim()) +
          "&lon=" + encodeURIComponent(place.split(",")[1].trim())
        : null;
    if (!query) return;

    fetch(ORIGIN + "/api/widget?" + query)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || data.error) return;
        css();
        render(node, data);
        // The href the author pasted wins; we only fill one in when it is missing, so a snippet
        // typed from memory still links somewhere correct.
        if (node.tagName === "A" && !node.getAttribute("href")) node.setAttribute("href", data.url);
      })
      .catch(function () {
        // Silence is the right failure. The anchor the author wrote is still on their page, still
        // says what it said, and still links here — which is more than a broken widget would.
      });
  }

  function scan() {
    var nodes = document.querySelectorAll("[data-airsignal]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
  // Re-scan for anything a single-page app mounts later. Cheap, since mount() is idempotent.
  window.airsignal = { scan: scan };
})();
`;

  return new Response(script, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // A day at the edge, and revalidated: this file changes rarely and is fetched by every
      // visitor to every page that embeds us.
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "access-control-allow-origin": "*",
    },
  });
};
