/**
 * Open-Meteo through three layers, so one city's traffic cannot burn the day's quota and a refused
 * day does not blank a plan.
 *
 * Open-Meteo's free tier counts calls per source IP (10 000 a day), and a Worker's egress IP is
 * shared with every other tenant on that Cloudflare colo. On 3 Nov 2026 /api/crew for Antalya got
 * `429 Daily API request limit exceeded` for the whole day: the quota was gone before our first
 * call. Caching our own calls cannot buy back someone else's, so the layers are:
 *
 * 1. **The isolate**: the in-flight promise, keyed by URL. Fifty requests in the same second share
 *    one download (request coalescing).
 * 2. **The colo's Cache API**, keyed by the URL plus the UTC hour: the forecast for a grid cell is
 *    fetched at most once an hour per colo, whatever the traffic.
 * 3. **KV, the last good answer, 48 h**: when Open-Meteo refuses (429, 5xx, timeout) the plan is
 *    built from the newest answer any colo stored. A 3-day forecast fetched yesterday still covers
 *    today, and the answer says it is stale (`stale_hours`).
 *
 * Callers round coordinates to a grid cell first (`cell`), or every street gets its own cache line.
 * The CLI fills the KV layer from outside Cloudflare for the Turkish towns (`warm-crew`), so a plan
 * there has a stored answer even on a day the shared egress IP is refused from the first call.
 */

import { env } from "cloudflare:workers";

export { cell } from "./forecast-urls";

const KV_TTL_S = 48 * 3600;
const memo = new Map<string, Promise<CachedJson | null>>();
const MEMO_MAX = 64;
/** Why the last upstream call for a URL failed, for the error a caller throws. */
export const upstreamFailures = new Map<string, string>();

export interface CachedJson {
  body: any;
  /** When Open-Meteo produced it, ms. */
  fetched_at: number;
  /** Hours since then when it came from the last-good store because the upstream refused; else 0. */
  stale_hours: number;
}

const hourKey = (url: string) => {
  const k = new URL("https://upstream-cache.airsignal.app/");
  k.searchParams.set("u", url);
  k.searchParams.set("h", new Date().toISOString().slice(0, 13));
  return new Request(k.href);
};

function kv(): KVNamespace | null {
  try {
    return (env as unknown as { UPSTREAM?: KVNamespace }).UPSTREAM ?? null;
  } catch {
    return null;
  }
}

function edge(): Cache | null {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

async function load(url: string, timeoutMs: number): Promise<CachedJson | null> {
  const cache = edge();
  const key = hourKey(url);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) {
    const v = (await hit.json().catch(() => null)) as { body: any; fetched_at: number } | null;
    if (v) return { ...v, stale_hours: 0 };
  }
  let reason = "no answer";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (res.ok) {
      const v = { body: JSON.parse(text), fetched_at: Date.now() };
      const s = JSON.stringify(v);
      // Both stores are best effort: a write that fails costs a future hit, never this answer.
      await Promise.allSettled([
        cache?.put(key, new Response(s, { headers: { "content-type": "application/json", "cache-control": "max-age=3600" } })),
        kv()?.put(url, s, { expirationTtl: KV_TTL_S }),
      ]);
      upstreamFailures.delete(url);
      return { ...v, stale_hours: 0 };
    }
    reason = `HTTP ${res.status} ${text.slice(0, 120)}`;
  } catch (e) {
    reason = String(e);
  }
  upstreamFailures.set(url, reason);
  const last = await kv()?.get(url).catch(() => null);
  if (last) {
    const v = JSON.parse(last) as { body: any; fetched_at: number };
    const stale = Math.round((Date.now() - v.fetched_at) / 3_600_000);
    console.warn(`upstream ${new URL(url).hostname} refused (${reason}); serving the answer from ${stale} h ago`);
    return { ...v, stale_hours: stale };
  }
  console.error(`upstream ${new URL(url).hostname} refused (${reason}) and no stored answer`);
  return null;
}

/**
 * JSON from Open-Meteo (or any keyless forecast URL) through the three layers. `null` only when the
 * upstream refused and no answer from the last 48 h is stored; `upstreamFailures` says why.
 */
export function cachedJson(url: string, timeoutMs = 8000): Promise<CachedJson | null> {
  const inflight = memo.get(url);
  if (inflight) return inflight;
  const p = load(url, timeoutMs);
  memo.set(url, p);
  // Coalescing only: once settled the promise leaves, and the Cache API answers the next caller.
  p.finally(() => setTimeout(() => memo.delete(url), 5_000));
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return p;
}
