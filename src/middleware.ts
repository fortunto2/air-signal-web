import type { MiddlewareHandler } from "astro";
import { SITE, paths } from "./lib/site";

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

/** Hosts that answer but must not rank. `air.miralinka.com` is where the Next version lived. */
const ALIAS_HOSTS = new Set(["air.miralinka.com", `www.${CANONICAL_HOST}`]);

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
    const to = new URL(context.url);
    to.protocol = "https:";
    to.hostname = CANONICAL_HOST;
    to.port = "";
    return new Response(null, { status: 301, headers: { location: to.href } });
  }

  // Note: a trailing slash never reaches here. The router rejects it before middleware runs, so
  // the forgiving redirect lives in src/pages/404.astro, which *is* reached.

  // A direct hit on the twin. Same facts at a second address is the shape of a duplicate, so keep
  // it out of the index and let the page it mirrors do the ranking. A .md file has nowhere to put
  // a robots meta tag, which is why this is a header.
  if (path.endsWith(".md")) {
    const direct = await next();
    const marked = withHeaders(direct, PAGE_CACHE);
    marked.headers.set("x-robots-tag", "noindex");
    return marked;
  }

  const twin = markdownPath(path);
  if (twin) {
    const accept = context.request.headers.get("accept") ?? "";
    const markdownQ = quality(accept, "text/markdown");
    if (markdownQ > 0 && markdownQ >= quality(accept, "text/html")) {
      // `rewrite`, not `fetch`. Fetching our own origin from inside the Worker is a real network
      // hop back through the edge, and in the local runtime it fails outright with an internal
      // error. `rewrite` re-runs the router in-process and keeps the visitor's URL — which is also
      // what we want for SEO, since the response is served at the page's own canonical address.
      const md = await context.rewrite(twin);
      // Falling back to HTML is the honest answer when there is no twin: a 404 would claim the
      // page does not exist, which is not what happened. Deliberately NOT marked noindex — this
      // response is served at the page's own canonical URL.
      if (md.status === 200) return withHeaders(md);
    }
  }

  const response = await next();
  return withHeaders(response, response.status >= 400 ? NO_CACHE : PAGE_CACHE);
};
