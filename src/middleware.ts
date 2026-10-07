import type { MiddlewareHandler } from "astro";
import { SITE, paths } from "./lib/site";
import { cacheKey, edgeLookup, edgeStore } from "./lib/edge-cache";

/**
 * Three jobs, all of which exist because the site is server-rendered.
 *
 * 1. **Cache at the edge.** Every page here is a pure function of the database, and the database
 *    changes once a day. Without `s-maxage` each visitor costs a D1 round trip and CPU; with it,
 *    the colo answers everything after the first hit and the origin sees a trickle. This is what
 *    makes SSR as fast as the static build it replaced — it is not an optimisation, it is the
 *    load-bearing half of the architecture.
 *
 * 2. **Content negotiation.** A client asking for `text/markdown` at a city URL gets the Markdown
 *    twin, without having to know the `.md` convention exists.
 *
 * 3. **Vary on Accept.** A shared cache that does not know a response depends on `Accept` hands one
 *    visitor's representation to the next — which, since agents are the ones asking for Markdown,
 *    breaks exactly the case the feature exists for. The header goes on the HTML too, and that is
 *    the half that is easy to forget.
 */

/** Long enough that a crawl of ten thousand pages mostly hits cache; short enough to feel live. */
const PAGE_CACHE = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";

/** Never cache an error as though it were the answer. */
const NO_CACHE = "no-store";

const CANONICAL_HOST = new URL(SITE.origin).hostname;

/**
 * Hosts that answer but must not rank, and where each one lands.
 *
 * `null` keeps the path, which is what `www` wants: it is the same site under a second spelling and
 * every URL on it exists here. `air.miralinka.com` is different — it is where the Next version
 * lived, its paths (`/city/<name>`) do not map onto ours, and the one thing Google knows about it is
 * its root. It belongs to a site about one stretch of the Turkish coast, so it lands on the town
 * there rather than on a global home page that answers a question its visitors did not ask.
 */
const ALIAS_HOSTS = new Map<string, string | null>([
  ["air.miralinka.com", paths.city("turkey", "gazipasa")],
  [`www.${CANONICAL_HOST}`, null],
]);

/**
 * The q-value this Accept header gives a media type, or -1 if it does not name it.
 *
 * Exact matches only — `*​/*` deliberately does not count. Browsers send
 * `text/html,…,*​/*;q=0.8`, and treating that wildcard as consent would hand Markdown to every
 * visitor whose browser was merely being polite.
 */
function quality(accept: string, type: string): number {
  let best = -1;
  for (const part of accept.split(",")) {
    const [raw, ...params] = part.split(";");
    if (raw?.trim().toLowerCase() !== type) continue;
    let q = 1;
    for (const p of params) {
      const token = p.trim().toLowerCase();
      if (token.startsWith("q=")) {
        const parsed = Number.parseFloat(token.slice(2));
        q = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    if (q > best) best = q;
  }
  return best;
}

/**
 * `/turkey/alanya` twins to `/turkey/alanya.md`.
 *
 * Built through `paths.cityMarkdown` rather than by appending `.md`, so the twin's shape is stated
 * once beside the shape of the page it mirrors. The segment count is still a proxy for "this is a
 * city URL" — when `ru`/`tr` land it becomes wrong, and this is the line that has to move.
 */
function markdownPath(pathname: string): string | null {
  if (pathname.includes(".")) return null;
  const segments = pathname.split("/").filter(Boolean);
  // The root twins too. An agent checking one URL checks that one, and it was the reason an
  // agent-readiness audit reported this site as HTML-only while every city page had a twin.
  if (segments.length === 0) return "/index.md";
  if (segments.length === 1) return paths.countryMarkdown(segments[0]!);
  if (segments.length === 2) return paths.cityMarkdown(segments[0]!, segments[1]!);
  return null;
}

function withHeaders(response: Response, cacheControl?: string): Response {
  const headers = new Headers(response.headers);
  if (cacheControl && !headers.has("cache-control")) headers.set("cache-control", cacheControl);

  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Accept");
  else if (!/\baccept\b/i.test(vary)) headers.set("vary", `${vary}, Accept`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  const path = context.url.pathname;

  // Astro's asset pipeline already fingerprints /_astro/* and sets immutable headers on it.
  // Re-stamping here would replace a year-long cache with ten minutes, and marking assets
  // `Vary: Accept` would split the WASM binary into a cache entry per distinct Accept string.
  if (path.startsWith("/_astro/") || path.startsWith("/_image")) return next();

  if (context.request.method !== "GET" && context.request.method !== "HEAD") return next();

  // One indexable host. `air.miralinka.com` is where the Next version lived, and `www` is the
  // habit everyone has; both answer here so no link breaks, and both hand their authority to the
  // canonical origin rather than competing with it as a duplicate.
  //
  // Deliberately an allow-list rather than "anything that is not airsignal.app": localhost and
  // the preview host have to keep working, and a blanket rule would redirect them into production
  // the first time someone ran `wrangler dev`.
  const host = context.url.hostname;
  if (ALIAS_HOSTS.has(host)) {
    const fixed = ALIAS_HOSTS.get(host);
    const to = new URL(context.url);
    to.protocol = "https:";
    to.hostname = CANONICAL_HOST;
    to.port = "";
    // A fixed destination drops the query too. The old app's `?city=` params mean nothing here, and
    // carrying them onto a page that ignores them would fork one destination into many URLs.
    if (fixed !== null && fixed !== undefined) {
      to.pathname = fixed;
      to.search = "";
    }
    return new Response(null, { status: 301, headers: { location: to.href } });
  }

  // Note: a trailing slash never reaches here. The router rejects it before middleware runs, so
  // the forgiving redirect lives in src/pages/404.astro, which *is* reached.

  // What the request is for, before any of it is produced: the twin's Markdown or the page's HTML.
  // Decided up front because the cache key has to say which, and the key is checked first.
  const twin = markdownPath(path);
  const accept = context.request.headers.get("accept") ?? "";
  const markdownQ = quality(accept, "text/markdown");
  const wantsMarkdown = twin !== null && markdownQ > 0 && markdownQ >= quality(accept, "text/html");

  // The edge cache. Pages are a pure function of a database that changes once a day, so a hit is
  // the whole answer; the `s-maxage` each page already sets is the TTL. See src/lib/edge-cache.ts
  // for why the CDN never did this on its own.
  const key = cacheKey(context.url, wantsMarkdown);
  if (context.request.method === "GET") {
    const hit = await edgeLookup(key);
    if (hit) return hit;
  }
  const cf = context.locals.cfContext;
  const waitUntil = cf ? cf.waitUntil.bind(cf) : undefined;

  // A direct hit on the twin. Same facts at a second address is the shape of a duplicate, so keep
  // it out of the index and let the page it mirrors do the ranking. A .md file has nowhere to put
  // a robots meta tag, which is why this is a header.
  if (path.endsWith(".md")) {
    const direct = await next();
    const marked = withHeaders(direct, direct.status >= 400 ? NO_CACHE : PAGE_CACHE);
    marked.headers.set("x-robots-tag", "noindex");
    return edgeStore(key, marked, waitUntil);
  }

  if (wantsMarkdown) {
    // `rewrite`, not `fetch`. Fetching our own origin from inside the Worker is a real network
    // hop back through the edge, and in the local runtime it fails outright with an internal
    // error. `rewrite` re-runs the router in-process and keeps the visitor's URL — which is also
    // what we want for SEO, since the response is served at the page's own canonical address.
    const md = await context.rewrite(twin!);
    // Falling back to HTML is the honest answer when there is no twin: a 404 would claim the
    // page does not exist, which is not what happened. Deliberately NOT marked noindex — this
    // response is served at the page's own canonical URL.
    if (md.status === 200) return edgeStore(key, withHeaders(md), waitUntil);
  }

  const response = await next();
  return edgeStore(key, withHeaders(response, response.status >= 400 ? NO_CACHE : PAGE_CACHE), waitUntil);
};
