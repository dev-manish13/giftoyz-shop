import { Hono } from "hono";
import { z } from "zod";
import { orderAlert, sendAlert } from "./alerts";
import { requireAdmin } from "./auth";
import { phoneDigest, randomToken, sha256 } from "./crypto";
import { codDefault, isHttps, now, type App } from "./env";
import { body, clean, HttpError, isConstraintError } from "./http";
import { renderInvoice } from "./invoice";
import { getRate, parcelKg, weightedFee } from "./rates";
import { allow, clientIp } from "./ratelimit";
import { addNonce, nonce, pagePolicy, tokensMatch } from "./security";
import { getSettings } from "./settings";
import { getTaxonomy } from "./taxonomy";

export const REF = /^GT-\d{6}-\d{4}$/;
export const PHONE = /^9[678]\d{8}$/;
const NPT_MS = (5 * 60 + 45) * 60 * 1000;

export const TRANSITIONS: Record<string, Set<string>> = {
  payment_pending: new Set(["confirmed", "cancelled"]),
  received: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["in_transit", "cancelled"]),
  with_ncm: new Set(["in_transit", "delivered", "cancelled"]),
  in_transit: new Set(["delivered", "cancelled"]),
  delivered: new Set(),
  cancelled: new Set(),
};
export const STOCK_HELD = new Set(["payment_pending", "received", "confirmed", "with_ncm", "in_transit", "delivered"]);

const printable = (max: number, min = 0) => z.string().trim().min(min).max(max).transform(clean);

const OrderRequest = z.strictObject({
  ref: z.string().trim().regex(/^(GT-\d{6}-\d{4})?$/).default(""),
  items: z
    .array(z.strictObject({ id: z.number().int().gt(0).lt(1_000_000), color: z.string().min(2).max(20), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(20),
  name: printable(80, 2),
  phone: z.string().trim().regex(PHONE),
  phone2: z.string().trim().regex(/^(9[678]\d{8})?$/).default(""),
  location_key: z.string().trim().min(2).max(60),
  district: printable(40).default(""),
  delivery: z.enum(["home", "branch"]),
  address: printable(200, 6),
  gift: z.strictObject({ note: printable(200).default(""), hideSlip: z.boolean().default(true) }).nullable().default(null),
  mode: z.enum(["cod", "full"]),
  wallet: z.enum(["esewa", "khalti", "bank"]).default("esewa"),
  txn: printable(40).default(""),
  lang: z.enum(["en", "ne"]).default("en"),
});

const StatusChange = z.strictObject({ status: z.enum(["confirmed", "in_transit", "delivered", "cancelled"]) });

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Order = Record<string, any>;

export const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const title = (key: string) =>
  key
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .replace("Newroad", "New Road");

export function publicOrder(o: Order) {
  const pay = o.payment;
  return {
    id: o.id,
    createdAt: o.createdAt,
    status: o.status,
    history: o.history,
    items: o.items.map((i: Order) => ({ id: i.id, itemId: i.itemId, name: i.name, color: i.color, qty: i.qty, price: i.price })),
    location: o.location,
    subtotal: o.subtotal,
    total: o.total,
    payment: { mode: pay.mode, wallet: pay.wallet, paidNow: pay.paidNow, due: pay.due, verified: pay.verified, gateway: pay.gateway },
    ncm: o.ncm ? { id: o.ncm.id } : null,
  };
}

function nepalDays(t: number): { day: string; near: Set<string> } {
  const fmt = (ms: number) => new Date(ms + NPT_MS).toISOString().slice(2, 10).replace(/-/g, "");
  const ms = t * 1000;
  return { day: fmt(ms), near: new Set([fmt(ms - 86_400_000), fmt(ms), fmt(ms + 86_400_000)]) };
}

const stockSql = (delta: string) =>
  `UPDATE products SET data = json_set(data, '$.stock', MAX(0, CAST(json_extract(data, '$.stock') AS INTEGER) + ${delta})) WHERE num_id = ?`;
const STOCK_GUARD =
  "SELECT CASE WHEN (SELECT CAST(json_extract(data, '$.stock') AS INTEGER) FROM products WHERE num_id = ? AND visible = 1) >= ? THEN 1 ELSE json('out-of-stock') END";

export function stockChange(db: D1Database, numId: number, delta: number): D1PreparedStatement {
  return db.prepare(stockSql("?")).bind(delta, numId);
}

async function createOrder(db: D1Database, cod: boolean, req: z.output<typeof OrderRequest>): Promise<{ order: Order; token: string }> {
  const shop = await getSettings(db, cod);
  if (shop.orders_paused) throw new HttpError(503, req.lang === "en" ? shop.pause_en : shop.pause_ne || shop.pause_en);
  const rate = await getRate(db, req.location_key.toUpperCase());
  if (!rate) throw new HttpError(422, "We don't deliver to that place. Pick one from the list.");

  const wanted = new Map<number, number>();
  const items: Order[] = [];
  for (const line of req.items) {
    const row = await db.prepare("SELECT data FROM products WHERE num_id = ? AND visible = 1").bind(line.id).first<{ data: string }>();
    if (!row) throw new HttpError(409, "An item in your cart is no longer available.");
    const p = JSON.parse(row.data) as Order;
    if (p.price == null) throw new HttpError(409, `${p.name} has no price yet.`);
    if (!p.colors.includes(line.color)) throw new HttpError(422, `${p.name} doesn't come in that colour.`);
    const total = (wanted.get(line.id) ?? 0) + line.qty;
    wanted.set(line.id, total);
    if (total > Number(p.stock ?? 0)) throw new HttpError(409, `Only ${p.stock ?? 0} left of ${p.name}.`);
    items.push({ id: line.id, itemId: p.itemId, name: p.name, color: line.color, qty: line.qty, price: Math.trunc(p.price), weight_kg: Number(p.weight_kg ?? 0.5) });
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const fee = weightedFee(req.delivery === "home" ? rate.home : rate.branch, parcelKg(items.map((i) => ({ weight_kg: Number(i.weight_kg), qty: Number(i.qty) }))));
  const total = subtotal + fee;
  const paidNow = req.mode === "full" ? total : shop.codAdvance ? fee : 0;
  const status = paidNow > 0 ? "payment_pending" : "received";
  const token = randomToken(24);
  const tokenDigest = await sha256(token);
  const digest = await phoneDigest(db, req.phone);
  const t = now();
  const { day, near } = nepalDays(t);

  const candidates: string[] = [];
  if (req.ref && near.has(req.ref.slice(3, 9))) candidates.push(req.ref);
  while (candidates.length < 50) candidates.push(`GT-${day}-${1000 + Math.floor(Math.random() * 9000)}`);

  for (const id of candidates) {
    const order: Order = {
      id,
      createdAt: iso(t),
      lang: req.lang,
      server: true,
      name: req.name,
      phone: req.phone,
      phone2: req.phone2,
      location: { key: rate.key, name: title(rate.key), district: req.district, type: req.delivery, fee },
      address: req.address,
      gift: req.gift,
      payment: {
        mode: req.mode,
        wallet: paidNow > 0 ? req.wallet : null,
        gateway: null,
        txn: paidNow > 0 ? req.txn : "",
        paidNow,
        due: total - paidNow,
        screenshot: null,
        verified: false,
        pidx: null,
      },
      items,
      subtotal,
      total,
      status,
      history: [{ at: iso(t), status }],
      ncm: null,
    };
    const statements: D1PreparedStatement[] = [];
    for (const [numId, qty] of wanted) statements.push(db.prepare(STOCK_GUARD).bind(numId, qty), stockChange(db, numId, -qty));
    statements.push(
      db
        .prepare("INSERT INTO orders (id, phone_digest, token_digest, status, data, created_ts, updated_ts) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, digest, tokenDigest, status, JSON.stringify(order), t, t),
    );
    try {
      await db.batch(statements);
      return { order, token };
    } catch (err) {
      if (err instanceof Error && /malformed JSON/i.test(err.message)) {
        throw new HttpError(409, "Some items just sold out. Check your cart and try again.");
      }
      if (!isConstraintError(err)) throw err;
    }
  }
  throw new HttpError(503, "Too many orders today. Message us on WhatsApp.");
}

export async function orderForToken(db: D1Database, id: string, token: string): Promise<Order> {
  const row = await db.prepare("SELECT data, token_digest FROM orders WHERE id = ?").bind(id).first<{ data: string; token_digest: string }>();
  const ok = tokensMatch(row?.token_digest ?? (await sha256("")), await sha256(token));
  if (!ok || !row) throw new HttpError(404, "Order not found");
  return JSON.parse(row.data) as Order;
}

export async function saveOrder(db: D1Database, order: Order, extra: D1PreparedStatement[] = []): Promise<void> {
  await db.batch([
    ...extra,
    db.prepare("UPDATE orders SET data = ?, status = ?, updated_ts = ? WHERE id = ?").bind(JSON.stringify(order), order.status, now(), order.id),
  ]);
}

export function pushStatus(db: D1Database, order: Order, status: string, note = ""): D1PreparedStatement[] {
  const before = order.status;
  if (before === status) return [];
  const extra = before && STOCK_HELD.has(before) && status === "cancelled" ? order.items.map((i: Order) => stockChange(db, i.id, i.qty)) : [];
  order.status = status;
  if (status === "confirmed") order.payment.verified = true;
  const entry: Order = { at: iso(now()), status };
  if (note) entry.note = note.slice(0, 120);
  order.history.push(entry);
  return extra;
}

async function getOrder(db: D1Database, id: string): Promise<{ order: Order; updated: number }> {
  const row = await db.prepare("SELECT data, updated_ts FROM orders WHERE id = ?").bind(id).first<{ data: string; updated_ts: number }>();
  if (!row) throw new HttpError(404, "Order not found");
  return { order: JSON.parse(row.data) as Order, updated: row.updated_ts };
}

const tokenParam = (c: { req: { query: (k: string) => string | undefined } }) => {
  const token = c.req.query("token") ?? "";
  if (token.length < 20 || token.length > 80) throw new HttpError(422, [{ loc: ["query", "token"], msg: "invalid token" }]);
  return token;
};
const refPath = ":orderId{GT-[0-9]{6}-[0-9]{4}}";

export const orderRoutes = new Hono<App>()
  .post("/api/orders", async (c) => {
    const req = await body(c, OrderRequest);
    if (!(await allow(c.env.DB, `order:${clientIp(c.req.raw.headers)}`, 5, 60))) {
      throw new HttpError(429, "Too many orders from this connection. Wait a minute.");
    }
    const { order, token } = await createOrder(c.env.DB, codDefault(c.env), req);
    const alert = sendAlert(c.env, orderAlert(c.env, order as Parameters<typeof orderAlert>[1]));
    try {
      c.executionCtx.waitUntil(alert);
    } catch {
      await alert;
    }
    return c.json({ order: publicOrder(order), token, khalti: false });
  })
  .get(`/api/orders/${refPath}`, async (c) => {
    const order = await orderForToken(c.env.DB, c.req.param("orderId"), tokenParam(c));
    return c.json({ order: publicOrder(order) });
  })
  .get(`/invoice/${refPath}`, async (c) => {
    const order = await orderForToken(c.env.DB, c.req.param("orderId"), tokenParam(c));
    const [tax, shop] = await Promise.all([getTaxonomy(c.env.DB), getSettings(c.env.DB, codDefault(c.env))]);
    if (!shop.bills_enabled) throw new HttpError(404, "Bills aren't available yet.");
    const value = nonce();
    const html = addNonce(renderInvoice(order, shop, new Map(tax.colors.map((x) => [x.id, x.en]))), value);
    return c.html(html, 200, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": pagePolicy(value, isHttps(c.env)),
    });
  })
  .post("/api/payments/khalti/initiate", () => {
    throw new HttpError(503, "Khalti is not available");
  })
  .post("/api/payments/khalti/verify", () => {
    throw new HttpError(503, "Khalti is not available");
  })
  .get("/api/admin/orders", requireAdmin, async (c) => {
    const limit = Number(c.req.query("limit") ?? 300);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new HttpError(422, "limit must be 1 to 1000");
    const { results } = await c.env.DB.prepare("SELECT data FROM orders ORDER BY created_ts DESC LIMIT ?").bind(limit).all<{ data: string }>();
    return c.json({ orders: results.map((r) => JSON.parse(r.data) as Order) });
  })
  .post(`/api/admin/orders/${refPath}/status`, requireAdmin, async (c) => {
    const { status } = await body(c, StatusChange);
    const db = c.env.DB;
    const { order, updated } = await getOrder(db, c.req.param("orderId"));
    if (!TRANSITIONS[order.status]?.has(status)) throw new HttpError(409, `Can't go from ${order.status} to ${status}`);
    const extra = pushStatus(db, order, status);
    const res = await db.batch([
      ...extra.length ? [db.prepare("SELECT CASE WHEN (SELECT updated_ts FROM orders WHERE id = ?) = ? THEN 1 ELSE json('changed') END").bind(order.id, updated)] : [],
      ...extra,
      db.prepare("UPDATE orders SET data = ?, status = ?, updated_ts = ? WHERE id = ? AND updated_ts = ?").bind(JSON.stringify(order), order.status, now(), order.id, updated),
    ]).catch((err: unknown) => {
      if (err instanceof Error && /malformed JSON/i.test(err.message)) throw new HttpError(409, "The order changed meanwhile. Reload and try again.");
      throw err;
    });
    if (!res.at(-1)?.meta.changes) throw new HttpError(409, "The order changed meanwhile. Reload and try again.");
    return c.json({ order });
  });
