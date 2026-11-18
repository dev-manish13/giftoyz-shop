import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { codDefault, type App } from "./env";
import { body, clean } from "./http";

const QR_SRC = /^\/media\/products\/q-[a-f0-9]{12}\.png$/;
const text = (max: number, fallback = "") => z.string().trim().max(max).default(fallback).transform(clean);

const PayAccount = z.strictObject({
  name: text(60),
  number: z.string().trim().max(40).regex(/^[0-9 +-]*$/).default(""),
  bank: text(60),
});

const BannerImage = z.strictObject({
  src: z.string().regex(/^\/media\/products\/b-[a-f0-9]{12}$/),
  w: z.number().int().gt(0).lte(10000),
  h: z.number().int().gt(0).lte(10000),
  widths: z.array(z.union([z.literal(800), z.literal(1600), z.literal(2400)])).default([800, 1600, 2400]),
});

const DAY = /^(\d{4}-\d{2}-\d{2})?$/;
const LINK = /^((\/|[a-z0-9-]+(\.html)?(?=$|[?#]))[^\s<>"']*|https:\/\/[^\s<>"']+)?$/;

const Banner = z.strictObject({
  id: z.string().trim().regex(/^[a-f0-9]{8,16}$/),
  image: BannerImage,
  mobile: BannerImage.nullable().default(null),
  alt: text(160),
  title_en: text(80),
  title_ne: text(120),
  text_en: text(160),
  text_ne: text(220),
  cta_en: text(30),
  cta_ne: text(40),
  link: z.string().trim().max(300).regex(LINK).default(""),
  starts: z.string().trim().regex(DAY).default(""),
  ends: z.string().trim().regex(DAY).default(""),
  active: z.boolean().default(true),
});
type Banner = z.output<typeof Banner>;

const qr = z.string().regex(QR_SRC).nullable().default(null);

export const ShopSettings = z.object({
  phone: z.string().trim().regex(/^\d{7,15}$/).default("9709119177"),
  whatsapp: z.string().trim().regex(/^977\d{10}$/).default("9779709119177"),
  instagram: z.string().trim().regex(/^[A-Za-z0-9._]{1,30}$/).default("giftoyz.np"),
  tiktok: z.string().trim().regex(/^([A-Za-z0-9._]{2,24})?$/).default("giftoyz.np"),
  facebook: z.string().trim().regex(/^([A-Za-z0-9.]{5,50})?$/).default(""),
  email: z.string().trim().regex(/^([^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,})?$/).default(""),
  hours_en: text(80, "Every day, 9 am to 8 pm"),
  hours_ne: text(120, "हरेक दिन, बिहान ९ देखि बेलुका ८ बजेसम्म"),
  orders_paused: z.boolean().default(false),
  pause_en: text(160, "We're taking a short break. Orders open again soon."),
  pause_ne: text(200, "हामी केही दिनको बिदामा छौं। छिट्टै फेरि अर्डर खुल्छ।"),
  announce_en: text(160, "Delivery to 300+ places across Nepal."),
  announce_ne: text(200, "नेपालभर ३००+ ठाउँमा डेलिभरी।"),
  codAdvance: z.boolean().optional(),
  lowStock: z.number().int().min(0).max(1000).default(5),
  happy_customers: z.number().int().min(0).max(1_000_000).default(100),
  qr: z.strictObject({ esewa: qr, khalti: qr, bank: qr }).default({ esewa: null, khalti: null, bank: null }),
  qr_info: z
    .strictObject({ esewa: PayAccount.prefault({}), khalti: PayAccount.prefault({}), bank: PayAccount.prefault({}) })
    .prefault({}),
  banners: z.array(Banner).max(8).default([]),
  banners_enabled: z.boolean().default(true),
  banner_seconds: z.number().int().min(3).max(20).default(6),
  bills_enabled: z.boolean().default(false),
  hero: z
    .array(z.strictObject({ id: z.number().int().gt(0).lt(1_000_000), label: z.enum(["", "best", "hot", "new"]).default("") }))
    .max(3)
    .default([]),
});
export type ShopSettings = Omit<z.output<typeof ShopSettings>, "codAdvance"> & { codAdvance: boolean };

export function withDefaults(raw: unknown, cod: boolean): ShopSettings {
  const s = ShopSettings.parse(raw);
  return { ...s, codAdvance: s.codAdvance ?? cod };
}

export async function getSettings(db: D1Database, cod: boolean): Promise<ShopSettings> {
  const row = await db.prepare("SELECT data FROM shop_settings WHERE id = 1").first<{ data: string }>();
  return withDefaults(row ? JSON.parse(row.data) : {}, cod);
}

const NPT_MS = (5 * 60 + 45) * 60 * 1000;

export function nepalDay(at = Date.now()): string {
  return new Date(at + NPT_MS).toISOString().slice(0, 10);
}

const showing = (b: Banner, day: string) => b.active && (!b.starts || b.starts <= day) && (!b.ends || day <= b.ends);

export function publicView(s: ShopSettings, at = Date.now()): ShopSettings {
  const day = nepalDay(at);
  return { ...s, banners: s.banners_enabled ? s.banners.filter((b) => showing(b, day)) : [] };
}

export const settingsRoutes = new Hono<App>()
  .get("/api/settings", async (c) => c.json({ settings: publicView(await getSettings(c.env.DB, codDefault(c.env))) }))
  .get("/api/admin/settings", requireAdmin, async (c) => c.json({ settings: await getSettings(c.env.DB, codDefault(c.env)) }))
  .put("/api/admin/settings", requireAdmin, async (c) => {
    const parsed = await body(c, ShopSettings);
    const value: ShopSettings = { ...parsed, codAdvance: parsed.codAdvance ?? codDefault(c.env) };
    await c.env.DB
      .prepare("INSERT INTO shop_settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .bind(JSON.stringify(value))
      .run();
    return c.json({ settings: value });
  });
