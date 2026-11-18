export interface Rate {
  key: string;
  home: number;
  branch: number;
}

export const FREE_KG = 2;

export function parcelKg(items: { weight_kg?: number; qty: number }[]): number {
  return Math.round(items.reduce((s, i) => s + Number(i.weight_kg ?? 0.5) * i.qty, 0) * 100) / 100;
}

export function weightedFee(base: number, kg: number): number {
  return kg <= FREE_KG ? base : Math.round(base * (kg - 1));
}

export async function getRate(db: D1Database, key: string): Promise<Rate | null> {
  return db.prepare("SELECT key, home, branch FROM rates WHERE key = ?").bind(key).first<Rate>();
}

export async function publicRates(db: D1Database): Promise<Record<string, [number, number]>> {
  const { results } = await db.prepare("SELECT key, home, branch FROM rates ORDER BY key").all<Rate>();
  return Object.fromEntries(results.map((r) => [r.key, [r.home, r.branch]]));
}
