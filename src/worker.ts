/**
 * The Worker's entry: the adapter's `fetch` for every request, plus the one thing Astro has no
 * place for, a cron. `wrangler.jsonc` points `main` here and sets the schedule.
 */
import server from "@astrojs/cloudflare/entrypoints/server";
import { refreshGridCo2 } from "./lib/grid-co2";

export default {
  fetch: server.fetch,
  /** Every 30 minutes: CAISO's carbon intensity for today into `grid_co2` (src/lib/grid-co2.ts). */
  scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      refreshGridCo2()
        .then((r) =>
          console.log(
            `grid_co2: ${r.today} ${r.hours} hours written` +
              (r.backfilled.length ? `, backfilled ${r.backfilled.join(" ")}` : "") +
              (r.failed.length ? `, failed ${r.failed.join(" ")}` : "") +
              (r.pruned ? ", pruned" : ""),
          ),
        )
        .catch((e: Error) => console.error(`grid_co2: ${e.message}`)),
    );
  },
} satisfies ExportedHandler<Env>;
