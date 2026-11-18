import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { phoneDigest, sha256 } from "./crypto";
import { now, type App, type Env } from "./env";
import { body, clean, HttpError } from "./http";
import { NcmClient, NcmError } from "./ncm";
import { iso, PHONE, publicOrder, pushStatus, REF, saveOrder, TRANSITIONS, type Order } from "./orders";
import { allow, clientIp } from "./ratelimit";
import { tokensMatch } from "./security";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TRACK = /^(GT-\d{6}-\d{4}|\d{4,12})$/;
const BRANCH = /^[A-Z0-9][A-Z0-9 .()/&-]{1,59}$/;
const DELIVERY_TYPES = { home: "Door2Door", branch: "Door2Branch" } as const;
const FINAL_WORDS = ["return", "cancel", "reject"];
const MOVING_WORDS = ["picked", "pickup complete", "collected", "dispatch", "transit", "arrived", "sent for delivery", "out for delivery", "drop off", "sent to", "received at"];
const POLL_BATCH = 10;

export function ncmClient(env: Env, db = env.DB): NcmClient | null {
  if (!env.NCM_API_TOKEN) return null;
  return new NcmClient({ token: env.NCM_API_TOKEN, baseUrl: (env.NCM_BASE_URL ?? "https://demo.nepalcanmove.com").replace(/\/+$/, ""), db });
}

const requireClient = (env: Env) => {
  const client = ncmClient(env);
  if (!client) throw new HttpError(503, "NCM is not configured");
  return client;
};

export const pickupBranch = (env: Env) => (env.NCM_PICKUP_BRANCH ?? "").trim().toUpperCase();

export function ncmToStatus(text: string): "delivered" | "in_transit" | null {
  const t = text.toLowerCase();
  if (FINAL_WORDS.some((w) => t.includes(w))) return null;
  if (/(?<!un)(?<!not )\bdelivered\b/.test(t)) return "delivered";
  if (!t.includes("created") && MOVING_WORDS.some((w) => t.includes(w))) return "in_transit";
  return null;
}

export const isFinal = (text: string) => ncmToStatus(text) === "delivered" || FINAL_WORDS.some((w) => text.toLowerCase().includes(w));

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function when(raw: string): number {
  const s = raw.slice(0, 19);
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  m = /^(\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2})/.exec(s);
  if (m && MONTHS[m[2]!.toLowerCase()] !== undefined) return Date.UTC(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!, +m[4]!, +m[5]!);
  const t = Date.parse(raw);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export type Status = { status: string; at: string };

export function publicStatus(item: Record<string, any>): Status {
  const key = ["added_time", "created_at", "date", "time"].find((k) => item[k]);
  return { status: clean(String(item.status ?? "")).slice(0, 80), at: String(key ? item[key] : "").slice(0, 40) };
}

export function latestStatus(statuses: Status[]): string {
  if (!statuses.length) return "";
  const dated = statuses.filter((s) => when(s.at) !== Number.NEGATIVE_INFINITY);
  if (!dated.length) return statuses[0]!.status;
  return dated.reduce((a, b) => (when(b.at) > when(a.at) ? b : a)).status;
}

export const timeline = (statuses: Status[]) => [...statuses].sort((a, b) => when(b.at) - when(a.at)).slice(0, 30);

export async function applyNcm(db: D1Database, ref: string, statuses: Status[], details?: Record<string, any> | null): Promise<string> {
  const latest = latestStatus(statuses);
  if (!latest) return "";
  await db.prepare("UPDATE shipments SET last_status = ?, checked_ts = ? WHERE ref = ?").bind(latest.slice(0, 80), now(), ref).run();
  const row = await db.prepare("SELECT data, updated_ts FROM orders WHERE id = ?").bind(ref).first<{ data: string; updated_ts: number }>();
  if (!row) return latest;
  const order = JSON.parse(row.data) as Order;
  const target = ncmToStatus(latest);
  if (order.ncm) {
    order.ncm.status = latest;
    order.ncm.timeline = timeline(statuses);
    order.ncm.checked = iso(now());
    if (details) {
      if (details.destination_branch_name) order.ncm.branch = clean(String(details.destination_branch_name)).slice(0, 60);
      if (details.destination_branch_phone) order.ncm.branch_phone = clean(String(details.destination_branch_phone)).slice(0, 40);
      if (details.trackid) order.ncm.trackid = clean(String(details.trackid)).slice(0, 40);
    }
  }
  const extra: D1PreparedStatement[] = [];
  if (target === "delivered" && order.status === "with_ncm") extra.push(...pushStatus(db, order, "in_transit", `NCM: ${latest}`));
  if (target && TRANSITIONS[order.status]?.has(target)) extra.push(...pushStatus(db, order, target, `NCM: ${latest}`));
  await db.batch([
    ...extra,
    db.prepare("UPDATE orders SET data = ?, status = ?, updated_ts = ? WHERE id = ? AND updated_ts = ?").bind(JSON.stringify(order), order.status, now(), ref, row.updated_ts),
  ]);
  return latest;
}

const Dimensions = z.strictObject({ length_cm: z.number().gt(0).lte(200), width_cm: z.number().gt(0).lte(200), height_cm: z.number().gt(0).lte(200) });
const printable = (max: number, min = 0) => z.string().trim().min(min).max(max).transform(clean);

const ShipmentRequest = z.strictObject({
  ref: z.string().trim().regex(REF),
  name: printable(80, 2),
  phone: z.string().trim().regex(PHONE),
  phone2: z.string().trim().regex(/^(9[678]\d{8})?$/).default(""),
  address: printable(200, 3),
  branch: z.string().trim().regex(BRANCH),
  delivery: z.enum(["home", "branch"]),
  cod_charge: z.number().int().min(0).max(500_000),
  package: printable(120).default(""),
  instruction: printable(200).default(""),
  weight: z.number().gt(0).lte(30).default(1),
  dimensions: Dimensions.nullable().default(null),
});
type ShipmentRequest = z.output<typeof ShipmentRequest>;

const g = (n: number) => String(Number(n.toPrecision(6)));

export function ncmPayload(r: ShipmentRequest, pickup: string, branch: string): Record<string, string> {
  const parts = [`Receiver: ${r.name}`];
  if (r.instruction) parts.push(r.instruction.replace(/\.+$/, ""));
  if (r.dimensions) parts.push(`Size ${g(r.dimensions.length_cm)}x${g(r.dimensions.width_cm)}x${g(r.dimensions.height_cm)} cm`);
  return {
    name: r.name,
    phone: r.phone,
    phone2: r.phone2,
    cod_charge: String(r.cod_charge),
    address: r.address,
    fbranch: pickup,
    branch,
    package: r.package,
    vref_id: r.ref,
    instruction: parts.join(". ").slice(0, 200),
    delivery_type: DELIVERY_TYPES[r.delivery],
    weight: g(r.weight),
  };
}

async function branchFor(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare("SELECT ncm_name FROM rates WHERE key = ? AND ncm_name IS NOT NULL").bind(key).first<{ ncm_name: string }>();
  return row?.ncm_name ?? key;
}

export async function ship(env: Env, r: ShipmentRequest): Promise<{ ref: string; ncm_id: string; created: boolean }> {
  const client = requireClient(env);
  const pickup = pickupBranch(env);
  if (!pickup) throw new HttpError(503, "NCM_PICKUP_BRANCH is not set");
  if (env.NCM_ALLOW_CREATE === "false") throw new HttpError(503, "Creating NCM shipments is switched off on this test site");
  const db = env.DB;
  const reserved = await db
    .prepare("INSERT OR IGNORE INTO shipments (ref, ncm_id, phone_digest, created_ts) VALUES (?, NULL, ?, ?)")
    .bind(r.ref, await phoneDigest(db, r.phone), now())
    .run();
  if (!reserved.meta.changes) {
    const row = await db.prepare("SELECT ncm_id, uncertain FROM shipments WHERE ref = ?").bind(r.ref).first<{ ncm_id: string | null; uncertain: number }>();
    if (row?.ncm_id) return { ref: r.ref, ncm_id: row.ncm_id, created: false };
    if (row?.uncertain) {
      throw new HttpError(409, "The last attempt timed out and may have reached NCM. Check the NCM portal, then resolve it in the admin.");
    }
    throw new HttpError(409, "This shipment is already being created");
  }
  let ncmId: string;
  try {
    ncmId = await client.createOrder(ncmPayload(r, pickup, await branchFor(db, r.branch)));
  } catch (err) {
    if (err instanceof NcmError) {
      const sql = err.code === "NCM_TIMEOUT"
        ? "UPDATE shipments SET uncertain = 1 WHERE ref = ? AND ncm_id IS NULL"
        : "DELETE FROM shipments WHERE ref = ? AND ncm_id IS NULL";
      await db.prepare(sql).bind(r.ref).run();
      throw new HttpError(err.status, err.message);
    }
    await db.prepare("UPDATE shipments SET uncertain = 1 WHERE ref = ? AND ncm_id IS NULL").bind(r.ref).run();
    throw err;
  }
  await db.prepare("UPDATE shipments SET ncm_id = ?, uncertain = 0 WHERE ref = ?").bind(ncmId, r.ref).run();
  return { ref: r.ref, ncm_id: ncmId, created: true };
}

async function lookupForCustomer(db: D1Database, query: string, phone: string): Promise<{ ref: string; ncmId: string } | null> {
  const row = await db
    .prepare("SELECT ref, ncm_id, phone_digest FROM shipments WHERE ref = ? OR ncm_id = ?")
    .bind(query, query)
    .first<{ ref: string; ncm_id: string | null; phone_digest: string }>();
  const ok = tokensMatch(row?.phone_digest ?? (await sha256("")), await phoneDigest(db, phone));
  return row && row.ncm_id && ok ? { ref: row.ref, ncmId: row.ncm_id } : null;
}

async function orderForCustomer(db: D1Database, id: string, phone: string): Promise<Order | null> {
  const row = await db.prepare("SELECT data FROM orders WHERE id = ?").bind(id).first<{ data: string }>();
  if (!row) return null;
  const order = JSON.parse(row.data) as Order;
  return tokensMatch(String(order.phone), phone) ? order : null;
}

const query = (c: { req: { query: (k: string) => string | undefined } }, name: string, re: RegExp) => {
  const v = c.req.query(name) ?? "";
  if (!re.test(v)) throw new HttpError(422, [{ loc: ["query", name], msg: "invalid" }]);
  return v;
};

export async function pollShipments(env: Env): Promise<number> {
  const client = ncmClient(env);
  if (!client) return 0;
  const { results } = await env.DB
    .prepare("SELECT ref, ncm_id, last_status FROM shipments WHERE ncm_id IS NOT NULL ORDER BY checked_ts ASC LIMIT 60")
    .all<{ ref: string; ncm_id: string; last_status: string }>();
  let checked = 0;
  for (const s of results) {
    if (checked >= POLL_BATCH) break;
    if (s.last_status && isFinal(s.last_status)) continue;
    try {
      const order = await env.DB.prepare("SELECT data FROM orders WHERE id = ?").bind(s.ref).first<{ data: string }>();
      const ncm = order ? (JSON.parse(order.data) as Order).ncm : null;
      const raw = await client.orderStatuses(s.ncm_id);
      const details = ncm && !("branch_phone" in ncm) ? await client.orderDetails(s.ncm_id) : null;
      const latest = await applyNcm(env.DB, s.ref, raw.map(publicStatus), details);
      if (!latest) await env.DB.prepare("UPDATE shipments SET checked_ts = ? WHERE ref = ?").bind(now(), s.ref).run();
    } catch (err) {
      await env.DB.prepare("UPDATE shipments SET checked_ts = ? WHERE ref = ?").bind(now(), s.ref).run();
      if (!(err instanceof NcmError)) console.error(`NCM status check failed for ${s.ref}`, err);
    }
    checked++;
  }
  return checked;
}

const ResolveRequest = z.strictObject({ ncm_id: z.string().regex(/^(\d{4,12})?$/).default("") });

export const shippingRoutes = new Hono<App>()
  .post("/ncm/shipments", requireAdmin, async (c) => c.json(await ship(c.env, await body(c, ShipmentRequest))))
  .get("/ncm/shipments/:ref{GT-[0-9]{6}-[0-9]{4}}", requireAdmin, async (c) => {
    const client = requireClient(c.env);
    const ref = c.req.param("ref");
    const row = await c.env.DB.prepare("SELECT ncm_id FROM shipments WHERE ref = ?").bind(ref).first<{ ncm_id: string | null }>();
    if (!row?.ncm_id) throw new HttpError(404, "No NCM shipment for this order");
    try {
      const [details, statuses, comments] = await Promise.all([client.orderDetails(row.ncm_id), client.orderStatuses(row.ncm_id), client.orderComments(row.ncm_id)]);
      return c.json({ ref, ncm_id: row.ncm_id, details, statuses, comments });
    } catch (err) {
      if (err instanceof NcmError) throw new HttpError(err.status, err.message);
      throw err;
    }
  })
  .post("/api/admin/shipments/:ref{GT-[0-9]{6}-[0-9]{4}}/resolve", requireAdmin, async (c) => {
    const ref = c.req.param("ref");
    const { ncm_id } = await body(c, ResolveRequest);
    if (ncm_id) {
      await c.env.DB.prepare("UPDATE shipments SET ncm_id = ?, uncertain = 0 WHERE ref = ?").bind(ncm_id, ref).run();
      return c.json({ ref, ncm_id });
    }
    await c.env.DB.prepare("DELETE FROM shipments WHERE ref = ? AND ncm_id IS NULL").bind(ref).run();
    return c.json({ ref, ncm_id: null });
  })
  .post("/api/admin/orders/:orderId{GT-[0-9]{6}-[0-9]{4}}/ship", requireAdmin, async (c) => {
    const db = c.env.DB;
    const row = await db.prepare("SELECT data FROM orders WHERE id = ?").bind(c.req.param("orderId")).first<{ data: string }>();
    if (!row) throw new HttpError(404, "Order not found");
    const order = JSON.parse(row.data) as Order;
    if (order.status !== "confirmed" && order.status !== "with_ncm") throw new HttpError(409, "Confirm the order before sending it to NCM");
    const loc = order.location;
    const weight = order.items.reduce((s: number, i: Order) => s + Number(i.weight_kg ?? 0.5) * i.qty, 0);
    const request = ShipmentRequest.parse({
      ref: order.id,
      name: String(order.name).slice(0, 80),
      phone: order.phone,
      phone2: order.phone2 ?? "",
      address: `${order.address}, ${loc.name}`.slice(0, 200),
      branch: loc.key,
      delivery: loc.type,
      cod_charge: Math.trunc(order.payment.due),
      package: order.items.map((i: Order) => `${i.qty} x ${i.name}`).join(", ").slice(0, 120),
      instruction: order.gift?.hideSlip ? "Gift parcel. No price slip inside." : "",
      weight: Math.min(30, Math.max(0.5, Math.round(weight * 100) / 100)),
    });
    const result = await ship(c.env, request);
    const fresh = await db.prepare("SELECT data FROM orders WHERE id = ?").bind(order.id).first<{ data: string }>();
    const o = JSON.parse(fresh!.data) as Order;
    if (!o.ncm) o.ncm = { id: result.ncm_id, at: iso(now()) };
    const extra = pushStatus(db, o, "with_ncm");
    await saveOrder(db, o, extra);
    return c.json({ ...result, order: o });
  })
  .get("/ncm/track", async (c) => {
    const phone = query(c, "phone", PHONE);
    const ref = query(c, "ref", TRACK);
    if (!(await allow(c.env.DB, `track:${clientIp(c.req.raw.headers)}`, 10, 60))) throw new HttpError(429, "Too many lookups. Wait a minute.");
    const client = requireClient(c.env);
    const found = await lookupForCustomer(c.env.DB, ref, phone);
    if (!found) throw new HttpError(404, "Not found");
    try {
      return c.json({ ref: found.ref, statuses: (await client.orderStatuses(found.ncmId)).map(publicStatus) });
    } catch (err) {
      if (err instanceof NcmError) throw new HttpError(err.status === 503 ? 503 : 502, "Tracking is unavailable right now");
      throw err;
    }
  })
  .get("/api/track", async (c) => {
    const q = query(c, "q", TRACK);
    const phone = query(c, "phone", PHONE);
    const db = c.env.DB;
    if (!(await allow(db, `track:${clientIp(c.req.raw.headers)}`, 10, 60))) throw new HttpError(429, "Too many lookups. Wait a minute.");
    const shipment = await lookupForCustomer(db, q, phone);
    const ref = shipment ? shipment.ref : q;
    let order = ref.startsWith("GT-") ? await orderForCustomer(db, ref, phone) : null;
    if (!order && !shipment) throw new HttpError(404, "Not found");
    let statuses: Status[] = [];
    let live = true;
    const client = ncmClient(c.env);
    if (shipment && client) {
      try {
        statuses = timeline((await client.orderStatuses(shipment.ncmId)).map(publicStatus));
        await applyNcm(db, shipment.ref, statuses);
      } catch (err) {
        if (!(err instanceof NcmError)) throw err;
        live = false;
      }
    }
    if (order && statuses.length) order = await orderForCustomer(db, ref, phone);
    if (!statuses.length && order?.ncm?.timeline) {
      statuses = order.ncm.timeline;
      live = false;
    }
    const info = order?.ncm ?? {};
    return c.json({
      branch: info.branch ? { name: info.branch, phone: info.branch_phone ?? "" } : null,
      checked: info.checked ?? "",
      ref,
      awb: shipment?.ncmId ?? null,
      order: order ? publicOrder(order) : null,
      statuses,
      live,
    });
  })
  .post("/api/admin/ncm/webhook", requireAdmin, async (c) => {
    const client = requireClient(c.env);
    const base = c.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
    if (!c.env.NCM_WEBHOOK_SECRET || !base.startsWith("https://")) throw new HttpError(503, "Set NCM_WEBHOOK_SECRET and an https PUBLIC_BASE_URL first");
    try {
      await client.setWebhook(`${base}/api/ncm/webhook?token=${encodeURIComponent(c.env.NCM_WEBHOOK_SECRET)}`);
    } catch (err) {
      if (err instanceof NcmError) throw new HttpError(err.status, err.message);
      throw err;
    }
    return c.json({ status: "registered" });
  })
  .get("/api/admin/ncm/events", requireAdmin, async (c) => {
    const limit = Number(c.req.query("limit") ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new HttpError(422, "limit must be 1 to 500");
    const { results } = await c.env.DB.prepare("SELECT * FROM ncm_events ORDER BY id DESC LIMIT ?").bind(limit).all();
    return c.json({ events: results });
  })
  .post("/api/ncm/webhook", async (c) => {
    const secret = c.env.NCM_WEBHOOK_SECRET;
    if (!secret || !tokensMatch(secret, (c.req.query("token") ?? "").slice(0, 200))) throw new HttpError(401, "Bad token");
    const raw = await c.req.arrayBuffer();
    if (raw.byteLength > 16_384) throw new HttpError(413, "Too large");
    let payload: any;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw) || "{}");
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }
    const ncmId = payload && typeof payload === "object" && !Array.isArray(payload) ? String(payload.order_id ?? payload.orderid ?? "") : "";
    if (!/^\d+$/.test(ncmId)) throw new HttpError(422, "Missing order_id");
    const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const first = await c.env.DB.prepare("INSERT OR IGNORE INTO webhook_events (key, ts) VALUES (?, ?)").bind(key, now()).run();
    if (!first.meta.changes) return c.json({ status: "duplicate" });
    const row = await c.env.DB.prepare("SELECT ref FROM shipments WHERE ncm_id = ?").bind(ncmId).first<{ ref: string }>();
    const client = ncmClient(c.env);
    if (!row || !client) return c.json({ status: "ignored" });
    let statuses: Record<string, any>[];
    try {
      statuses = await client.orderStatuses(ncmId);
    } catch (err) {
      if (!(err instanceof NcmError)) throw err;
      await c.env.DB
        .prepare("INSERT INTO ncm_events (ts, ref, op, code, http_status, message) VALUES (?, ?, 'webhook', 'NCM_VERIFY_FAILED', 0, 'Status check after webhook failed')")
        .bind(now(), row.ref)
        .run();
      return c.json({ status: "deferred" });
    }
    if (!statuses.length) return c.json({ status: "ignored" });
    await applyNcm(c.env.DB, row.ref, statuses.map(publicStatus));
    return c.json({ status: "ok" });
  });
