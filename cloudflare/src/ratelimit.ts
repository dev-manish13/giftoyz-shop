import { now } from "./env";

const SQL = `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
RETURNING count`;

export async function allow(db: D1Database, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const t = now();
  const row = await db.prepare(SQL).bind(key.slice(0, 120), t, windowSeconds).first<{ count: number }>();
  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(t - 86400).run();
  }
  return (row?.count ?? 1) <= limit;
}

export function clientIp(headers: Headers): string {
  return (headers.get("cf-connecting-ip") ?? "unknown").slice(0, 64);
}
