/**
 * The edge cache src/middleware.ts always described, and never had.
 *
 * A Worker on a custom domain *is* the origin. Cloudflare's CDN never stores what a Worker returns,
 * however loud the `s-maxage` on it: that header only speaks to caches between the edge and the
 * reader, and there are none. Measured 7 Oct 2026: no `cf-cache-status` on any page, every request
 * a full render, 42M D1 rows a day on the nearby-cities query alone. The Cache API is the one edge
 * cache a Worker gets, and it stores only what is put into it. This is that.
 *
 * The key is the page's identity, not the request's spelling: host + path, the few query params a
 * page actually reads, and whether Markdown was negotiated. Everything else in the query is noise,
 * and noise was the September bill on the sister site: a crawler enumerating `?x=` variants of one
 * page, each a cache miss, each a render. `/api/*` keeps its whole query, since there the query is
 * the question.
 */

/** Query params some page reads (`ranking`, `countries`, `crew`). Any other param is dropped from the key. */
const PAGE_PARAMS = new Set(["sort", "thin", "place", "date", "shift"]);

type WaitUntil = (promise: Promise<unknown>) => void;

export function cacheKey(url: URL, markdown: boolean): Request {
  const key = new URL(url.origin + url.pathname);
  const names = [...new Set(url.searchParams.keys())]
    .filter((name) => url.pathname.startsWith("/api/") || PAGE_PARAMS.has(name))
    .sort();
  for (const name of names) key.searchParams.set(name, url.searchParams.get(name) ?? "");
  if (markdown) key.searchParams.set("__fmt", "md");
  return new Request(key.href, { method: "GET" });
}

/** `caches.default` exists in the Worker runtime, not under `astro dev`; the cache is optional there. */
function store(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

export async function edgeLookup(key: Request): Promise<Response | undefined> {
  const cache = store();
  if (!cache) return undefined;
  try {
    const hit = await cache.match(key);
    if (!hit) return undefined;
    // A response out of the cache has immutable headers, and the framework stamps its own onto
    // whatever middleware returns. Copying makes it an ordinary response again; the copy keeps the
    // `cf-cache-status: HIT` the runtime put on it, and the marker below says the hit was ours.
    const copy = new Response(hit.body, hit);
    copy.headers.set("x-edge-cache", "hit");
    return copy;
  } catch {
    return undefined;
  }
}

/**
 * Store a response under `key` and hand it back unchanged. Only a 200 that asked to be shared
 * (`s-maxage`) and set no cookie is stored; the Cache API reads the TTL from that same header.
 */
export function edgeStore(key: Request, response: Response, waitUntil?: WaitUntil): Response {
  const cache = store();
  if (!cache || response.status !== 200 || response.headers.has("set-cookie")) return response;
  if (!/s-maxage=[1-9]/.test(response.headers.get("cache-control") ?? "")) return response;
  const put = cache.put(key, response.clone()).catch(() => {
    // An unstorable response (too large, odd headers) costs the next reader one render, not a 500.
  });
  if (waitUntil) waitUntil(put);
  return response;
}
