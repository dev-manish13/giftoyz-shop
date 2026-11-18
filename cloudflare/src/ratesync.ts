import { Hono } from "hono";
import { requireAdmin } from "./auth";
import { now, type App, type Env } from "./env";
import { HttpError } from "./http";
import { NcmClient } from "./ncm";
import { ncmClient, pickupBranch } from "./shipping";

const HOME_TYPE = "Pickup/Collect";
const BRANCH_TYPE = "D2B";
const STEP = 12;
const LEASE = 90;

type Change = { key: string; old: [number, number]; new: [number, number] };
type Job = { running: boolean; origin: string; keys: string[]; cursor: number; updated: number; failed: string[]; changed: Change[]; lease: number };

async function readJob(db: D1Database): Promise<Job | null> {
  const row = await db.prepare("SELECT data FROM jobs WHERE name = 'rates'").first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Job) : null;
}

const writeJob = (db: D1Database, job: Job) =>
  db.prepare("INSERT INTO jobs (name, data) VALUES ('rates', ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data").bind(JSON.stringify(job));

export async function lastSync(db: D1Database): Promise<Record<string, unknown> | null> {
  const row = await db.prepare("SELECT data FROM rate_sync WHERE id = 1").first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
}

export async function startSync(db: D1Database, origin: string): Promise<number> {
  const job = await readJob(db);
  if (job?.running) throw new HttpError(409, "A price refresh is already running");
  const { results } = await db.prepare("SELECT key FROM rates ORDER BY key").all<{ key: string }>();
  await writeJob(db, { running: true, origin, keys: results.map((r) => r.key), cursor: 0, updated: 0, failed: [], changed: [], lease: 0 }).run();
  return results.length;
}

async function claim(db: D1Database): Promise<Job | null> {
  const t = now();
  const row = await db
    .prepare(
      "UPDATE jobs SET data = json_set(data, '$.lease', ?) WHERE name = 'rates' AND json_extract(data, '$.running') = 1 AND json_extract(data, '$.lease') < ? RETURNING data",
    )
    .bind(t, t - LEASE)
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Job) : null;
}

export async function stepSync(db: D1Database, client: NcmClient): Promise<boolean> {
  const job = await claim(db);
  if (!job) return false;
  const keys = job.keys.slice(job.cursor, job.cursor + STEP);
  const names = new Map<string, string>();
  if (keys.length) {
    const { results } = await db
      .prepare(`SELECT key, home, branch, ncm_name FROM rates WHERE key IN (${keys.map(() => "?").join(",")})`)
      .bind(...keys)
      .all<{ key: string; home: number; branch: number; ncm_name: string | null }>();
    const old = new Map(results.map((r) => [r.key, r]));
    for (const r of results) names.set(r.key, r.ncm_name ?? r.key);
    const writes: D1PreparedStatement[] = [];
    await Promise.all(
      keys.map(async (key) => {
        try {
          const name = names.get(key) ?? key;
          const [home, branch] = await Promise.all([client.shippingRate(job.origin, name, HOME_TYPE), client.shippingRate(job.origin, name, BRANCH_TYPE)]);
          if (home <= 0 || branch <= 0) throw new Error("zero price");
          const was = old.get(key);
          if (was && (was.home !== home || was.branch !== branch)) job.changed.push({ key, old: [was.home, was.branch], new: [home, branch] });
          writes.push(
            db
              .prepare(
                "INSERT INTO rates (key, home, branch, source, updated_ts) VALUES (?, ?, ?, 'ncm', ?) ON CONFLICT(key) DO UPDATE SET home = excluded.home, branch = excluded.branch, source = 'ncm', updated_ts = excluded.updated_ts",
              )
              .bind(key, home, branch, now()),
          );
          job.updated++;
        } catch {
          job.failed.push(key);
        }
      }),
    );
    job.cursor += keys.length;
    job.lease = 0;
    if (writes.length) await db.batch(writes);
  }
  if (job.cursor >= job.keys.length) {
    job.running = false;
    const failed = [...job.failed].sort();
    const summary = { at: now(), origin: job.origin, checked: job.keys.length, updated: job.updated, failed: failed.slice(0, 50), failed_count: failed.length, changed: job.changed };
    await db.batch([
      db.prepare("INSERT INTO rate_sync (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(JSON.stringify(summary)),
      writeJob(db, { ...job, keys: [], changed: [], failed: [] }),
    ]);
    console.log(`NCM prices refreshed: ${job.updated} updated, ${job.changed.length} changed, ${failed.length} failed`);
  } else {
    await writeJob(db, job).run();
  }
  return true;
}

export async function scheduledRates(env: Env): Promise<void> {
  const client = ncmClient(env);
  const origin = pickupBranch(env);
  if (!client || !origin) return;
  const job = await readJob(env.DB);
  if (!job?.running) {
    const hours = Number(env.NCM_RATES_HOURS ?? 24);
    const last = await lastSync(env.DB);
    if (hours <= 0 || (last && Number(last.at) + hours * 3600 > now())) return;
    await startSync(env.DB, origin);
  }
  await stepSync(env.DB, client);
}

export const rateRoutes = new Hono<App>()
  .get("/api/admin/rates", requireAdmin, async (c) => {
    const db = c.env.DB;
    let job = await readJob(db);
    const client = ncmClient(c.env);
    if (job?.running && client) {
      c.executionCtx.waitUntil(stepSync(db, client));
    }
    const [{ results }, last] = await Promise.all([
      db.prepare("SELECT key, home, branch, source, updated_ts, ncm_name FROM rates ORDER BY key").all(),
      lastSync(db),
    ]);
    job = await readJob(db);
    return c.json({ rates: results, last_sync: last, running: Boolean(job?.running), progress: job?.running ? { done: job.cursor, total: job.keys.length } : null });
  })
  .post("/api/admin/rates/sync", requireAdmin, async (c) => {
    const client = ncmClient(c.env);
    const origin = pickupBranch(c.env);
    if (!client || !origin) throw new HttpError(503, "NCM is not configured");
    const places = await startSync(c.env.DB, origin);
    c.executionCtx.waitUntil(stepSync(c.env.DB, client));
    return c.json({ started: true, places }, 202);
  });
