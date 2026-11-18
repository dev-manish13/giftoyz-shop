import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { ITEM_ID } from "./catalog";
import { now, type App } from "./env";
import { body, clean, HttpError } from "./http";
import { iso, PHONE, REF, type Order } from "./orders";
import { allow, clientIp } from "./ratelimit";
import { tokensMatch } from "./security";

export type Review = { id: number; name: string; stars: number; body: string; at: string };
export type ReviewStats = { count: number; average: number; reviews: Review[] };

const ReviewRequest = z.strictObject({
  item_id: z.string().trim().regex(ITEM_ID),
  order_id: z.string().trim().regex(REF),
  phone: z.string().trim().regex(PHONE),
  name: z.string().trim().min(2).max(40).transform(clean),
  stars: z.number().int().min(1).max(5),
  body: z.string().trim().min(3).max(600).transform(clean),
});

const Moderation = z.strictObject({ status: z.enum(["approved", "hidden", "pending"]) });

type Row = { id: number; item_id: string; order_id: string; name: string; stars: number; body: string; status: string; created_ts: number };

const publicReview = (r: Row): Review => ({ id: r.id, name: r.name, stars: r.stars, body: r.body, at: iso(r.created_ts) });

export async function reviewStats(db: D1Database, itemId: string, limit = 20): Promise<ReviewStats> {
  const [agg, list] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n, AVG(stars) AS avg FROM reviews WHERE item_id = ? AND status = 'approved'").bind(itemId).first<{ n: number; avg: number | null }>(),
    db.prepare("SELECT * FROM reviews WHERE item_id = ? AND status = 'approved' ORDER BY created_ts DESC LIMIT ?").bind(itemId, limit).all<Row>(),
  ]);
  return { count: agg?.n ?? 0, average: Math.round((agg?.avg ?? 0) * 10) / 10, reviews: list.results.map(publicReview) };
}

export async function allStats(db: D1Database): Promise<Record<string, [number, number]>> {
  const { results } = await db
    .prepare("SELECT item_id, COUNT(*) AS n, AVG(stars) AS avg FROM reviews WHERE status = 'approved' GROUP BY item_id")
    .all<{ item_id: string; n: number; avg: number }>();
  return Object.fromEntries(results.map((r) => [r.item_id, [r.n, Math.round(r.avg * 10) / 10]]));
}

export async function shopRating(db: D1Database): Promise<{ count: number; average: number }> {
  const row = await db.prepare("SELECT COUNT(*) AS n, AVG(stars) AS avg FROM reviews WHERE status = 'approved'").first<{ n: number; avg: number | null }>();
  return { count: row?.n ?? 0, average: Math.round((row?.avg ?? 0) * 10) / 10 };
}

export const reviewRoutes = new Hono<App>()
  .get("/api/reviews", async (c) => {
    const item = c.req.query("item") ?? "";
    if (!ITEM_ID.test(item)) throw new HttpError(422, [{ loc: ["query", "item"], msg: "invalid" }]);
    return c.json(await reviewStats(c.env.DB, item));
  })
  .post("/api/reviews", async (c) => {
    const req = await body(c, ReviewRequest);
    const db = c.env.DB;
    if (!(await allow(db, `review:${clientIp(c.req.raw.headers)}`, 5, 600))) throw new HttpError(429, "Too many reviews from this connection. Try again later.");
    const row = await db.prepare("SELECT data FROM orders WHERE id = ?").bind(req.order_id).first<{ data: string }>();
    const order = row ? (JSON.parse(row.data) as Order) : null;
    if (!order || !tokensMatch(String(order.phone), req.phone)) throw new HttpError(404, "We couldn't find that order with this phone number.");
    if (order.status !== "delivered") throw new HttpError(409, "You can review once your order is delivered.");
    if (!order.items.some((i: Order) => i.itemId === req.item_id)) throw new HttpError(422, "That item isn't in this order.");
    const res = await db
      .prepare("INSERT OR IGNORE INTO reviews (item_id, order_id, name, stars, body, status, created_ts) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
      .bind(req.item_id, req.order_id, req.name, req.stars, req.body, now())
      .run();
    if (!res.meta.changes) throw new HttpError(409, "You already reviewed this item. Thank you!");
    return c.json({ status: "pending" }, 201);
  })
  .get("/api/admin/reviews", requireAdmin, async (c) => {
    const { results } = await c.env.DB
      .prepare("SELECT * FROM reviews ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_ts DESC LIMIT 500")
      .all<Row>();
    return c.json({ reviews: results.map((r) => ({ ...publicReview(r), item_id: r.item_id, order_id: r.order_id, status: r.status })) });
  })
  .post("/api/admin/reviews/:id{[0-9]{1,9}}", requireAdmin, async (c) => {
    const { status } = await body(c, Moderation);
    const res = await c.env.DB.prepare("UPDATE reviews SET status = ? WHERE id = ?").bind(status, Number(c.req.param("id"))).run();
    if (!res.meta.changes) throw new HttpError(404, "No such review");
    return c.json({ status });
  })
  .delete("/api/admin/reviews/:id{[0-9]{1,9}}", requireAdmin, async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM reviews WHERE id = ?").bind(Number(c.req.param("id"))).run();
    if (!res.meta.changes) throw new HttpError(404, "No such review");
    return c.json({ deleted: true });
  });
