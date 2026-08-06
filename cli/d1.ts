/**
 * Writing to D1 from Node.
 *
 * The ETL runs here rather than in a Cron Worker because its two largest inputs are 9 MB JSON
 * documents; parsing those inside a 128 MB isolate to save a deploy step is a bad trade. So the
 * pipeline emits SQL and hands it to `wrangler d1 execute --file`, which is also the only write
 * path that exists — the worker has read access and nothing else.
 *
 * **The ETL never deletes.** Every statement below is an upsert. A bad minute at an upstream ages
 * a row; it does not remove a page. The static version of this site got that property for free by
 * committing its index to git, and losing it was the main thing to be careful about in moving to a
 * database.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** D1 caps a single SQL statement at 100 KB. Stay well under it and batching stays invisible. */
const MAX_STATEMENT_BYTES = 60_000;

export type SqlValue = string | number | boolean | null | undefined;

/** Literal-escape a value. There are no bind parameters in a file import, so this is the boundary. */
export function lit(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Multi-row upserts, chunked to fit D1's statement ceiling.
 *
 * `conflict` names the key columns; every other column is overwritten with the incoming value —
 * except where `keep` says otherwise, which is how `first_seen` survives a re-ingest.
 */
export function upsert(
  table: string,
  columns: string[],
  rows: SqlValue[][],
  opts: { conflict: string[]; keep?: string[]; coalesce?: string[] } = { conflict: ["id"] },
): string[] {
  if (rows.length === 0) return [];

  const keep = new Set(opts.keep ?? []);
  const coalesce = new Set(opts.coalesce ?? []);
  const updates = columns
    .filter((c) => !opts.conflict.includes(c) && !keep.has(c))
    .map((c) =>
      coalesce.has(c)
        ? // Keep the value we already had when the new pass has nothing to say. Used for readings
          // that only some upstreams provide, so a partial run cannot blank a good number.
          `${c} = COALESCE(excluded.${c}, ${table}.${c})`
        : `${c} = excluded.${c}`,
    );

  const head =
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n` as string;
  const tail = `\nON CONFLICT(${opts.conflict.join(", ")}) DO UPDATE SET ${updates.join(", ")};`;

  const out: string[] = [];
  let batch: string[] = [];
  let size = head.length + tail.length;

  for (const row of rows) {
    const tuple = `(${row.map(lit).join(",")})`;
    if (batch.length > 0 && size + tuple.length + 2 > MAX_STATEMENT_BYTES) {
      out.push(head + batch.join(",\n") + tail);
      batch = [];
      size = head.length + tail.length;
    }
    batch.push(tuple);
    size += tuple.length + 2;
  }
  if (batch.length > 0) out.push(head + batch.join(",\n") + tail);
  return out;
}

/**
 * Batched UPDATE by key, for passes that enrich rows that must already exist.
 *
 * `INSERT … ON CONFLICT DO UPDATE` cannot do this job, and the reason is a genuine SQLite
 * subtlety: NOT NULL is validated while the candidate row is being built, *before* any uniqueness
 * conflict is detected. So an upsert that supplies only `id` and a few measurements aborts with
 * "NOT NULL constraint failed: cities.country" — it never reaches the DO UPDATE branch, even
 * though the row it would have updated is sitting right there.
 *
 * Expressing it as an UPDATE is also the honest statement of intent: a comfort reading for a city
 * that does not exist is a bug, not a row to create.
 */
export function update(
  table: string,
  key: string,
  columns: string[],
  rows: SqlValue[][],
): string[] {
  if (rows.length === 0) return [];

  const cols = [key, ...columns];
  const set = columns.map((c) => `${c} = v.${c}`).join(", ");
  const head = `WITH v(${cols.join(", ")}) AS (VALUES\n`;
  const tail = `\n) UPDATE ${table} SET ${set} FROM v WHERE ${table}.${key} = v.${key};`;

  const out: string[] = [];
  let batch: string[] = [];
  let size = head.length + tail.length;

  for (const row of rows) {
    const tuple = `(${row.map(lit).join(",")})`;
    if (batch.length > 0 && size + tuple.length + 2 > MAX_STATEMENT_BYTES) {
      out.push(head + batch.join(",\n") + tail);
      batch = [];
      size = head.length + tail.length;
    }
    batch.push(tuple);
    size += tuple.length + 2;
  }
  if (batch.length > 0) out.push(head + batch.join(",\n") + tail);
  return out;
}

/** Run SQL against D1. `--local` by default: production is an explicit choice, never a default. */
export async function execute(
  statements: string[],
  opts: { remote?: boolean; label?: string } = {},
): Promise<void> {
  if (statements.length === 0) return;

  const dir = await mkdtemp(join(tmpdir(), "airsignal-d1-"));
  const file = join(dir, "batch.sql");
  await writeFile(file, statements.join("\n") + "\n");

  const bytes = statements.reduce((n, s) => n + s.length, 0);
  console.log(
    `  → ${opts.label ?? "sql"}: ${statements.length} statements, ${(bytes / 1024).toFixed(0)} KB` +
      `, ${opts.remote ? "remote" : "local"}`,
  );

  try {
    await run("npx", [
      "wrangler",
      "d1",
      "execute",
      "air-signal",
      opts.remote ? "--remote" : "--local",
      "--file",
      file,
      "--yes",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Read a scalar back out, for the checks that keep the ETL honest. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  opts: { remote?: boolean } = {},
): Promise<T[]> {
  const out = await run(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "air-signal",
      opts.remote ? "--remote" : "--local",
      "--command",
      sql,
      "--json",
    ],
    { capture: true },
  );
  try {
    const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
    return parsed[0]?.results ?? [];
  } catch {
    throw new Error(`could not parse wrangler output as JSON:\n${out.slice(0, 400)}`);
  }
}

function run(cmd: string, args: string[], opts: { capture?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "inherit"],
    });
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} ${args[0]} exited ${code}`)),
    );
  });
}
