/**
 * Fill the worker's last-good store (KV `UPSTREAM`) with Open-Meteo's answers for the Turkish towns,
 * fetched from here rather than from Cloudflare.
 *
 * Open-Meteo's free quota is per source IP, and a Worker shares its egress IP with every other
 * tenant on the colo: on 3 Nov 2026 it was gone before our first call of the day. The ingest runner
 * has its own IP and quota, so it fetches the 20 URLs (10 towns × air and weather) once and writes
 * them under the exact keys `src/lib/upstream-cache.ts` reads. The worker still fetches fresh when
 * it can; this only guarantees a plan has something under 48 h old when it cannot.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forecastUrls } from "../src/lib/forecast-urls.ts";
import { TR_PLACES, TR_TZ } from "../src/lib/tr-places.ts";

const TTL_S = 48 * 3600;

export async function warmCrew(opts: { remote: boolean }): Promise<void> {
  const entries: { key: string; value: string; expiration_ttl: number }[] = [];
  for (const p of TR_PLACES) {
    const urls = forecastUrls(p.lat, p.lon, TR_TZ);
    for (const url of [urls.air, urls.weather]) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      if (!res.ok) {
        console.error(`  ${p.name}: ${new URL(url).hostname} HTTP ${res.status} ${text.slice(0, 100)}`);
        continue;
      }
      JSON.parse(text); // a truncated body must not become the fallback
      entries.push({ key: url, value: JSON.stringify({ body: JSON.parse(text), fetched_at: Date.now() }), expiration_ttl: TTL_S });
    }
    console.log(`  ${p.name}: ok`);
  }
  if (!entries.length) throw new Error("warm-crew: Open-Meteo answered nothing; KV left as it was");
  const dir = await mkdtemp(join(tmpdir(), "warm-crew-"));
  const file = join(dir, "bulk.json");
  await writeFile(file, JSON.stringify(entries));
  try {
    await new Promise<void>((resolve, reject) => {
      const args = ["exec", "wrangler", "kv", "bulk", "put", file, "--binding", "UPSTREAM", opts.remote ? "--remote" : "--local"];
      const child = spawn("pnpm", args, { stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler kv bulk put exited ${code}`))));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`warm-crew: ${entries.length} answers stored for ${TR_PLACES.length} towns (${opts.remote ? "remote" : "local"} KV, 48 h)`);
}
