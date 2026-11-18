import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { now, type App } from "./env";
import { body, HttpError, isConstraintError } from "./http";
import { ARTS, checkProduct, getTaxonomy } from "./taxonomy";

export const ITEM_ID = /^GFT-[A-Z]{3}-\d{3}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEDIA_SRC = /^\/media\/products\/[a-z0-9-]+$/;
const str = (max: number) => z.string().trim().max(max);

const ProductImage = z.strictObject({
  src: z.string().regex(MEDIA_SRC),
  w: z.number().int().gt(0).lte(4000),
  h: z.number().int().gt(0).lte(4000),
  kind: z.enum(["hero", "detail", "lifestyle", "packaging"]),
  alt: z.string().min(3).max(160),
  formats: z.array(z.enum(["avif", "webp", "jpg"])).default(["avif", "webp", "jpg"]),
  widths: z.array(z.union([z.literal(600), z.literal(1200)])).default([600, 1200]),
  focal: z.partialRecord(z.enum(["x", "y"]), z.number().min(0).max(100)).default({ x: 50, y: 50 }),
  fit: z.enum(["cover", "contain"]).default("cover"),
  color: z.string().max(20).default(""),
});

export const Product = z
  .strictObject({
    itemId: z.string().trim().regex(ITEM_ID),
    id: z.number().int().gt(0).lt(1_000_000),
    slug: str(80).regex(SLUG),
    name: str(120).min(2),
    ne_name: str(160).default(""),
    cat: str(40).regex(SLUG),
    art: z.enum(ARTS),
    price: z.number().int().min(1).max(1_000_000).nullable().default(null),
    compare: z.number().int().min(0).max(1_000_000).default(0),
    stock: z.number().int().min(0).max(100_000).default(0),
    colors: z.array(str(40)).min(1).max(12),
    badge: z.enum(["", "best", "new", "gift", "personal"]).default(""),
    occasions: z.array(str(40)).max(12).default([]),
    blurb: str(400).default(""),
    ne_blurb: str(600).default(""),
    specs: z.array(str(120)).max(12).default([]),
    ne_specs: z.array(str(160)).max(12).default([]),
    images: z.array(ProductImage).max(8).default([]),
    weight_kg: z.number().gt(0).lte(30).default(0.5),
    visible: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (p.visible && p.price === null) ctx.addIssue({ code: "custom", message: "a product needs a price before it can be visible" });
  })
  .transform((p) => (p.compare && p.price && p.compare <= p.price ? { ...p, compare: 0 } : p));
export type Product = z.output<typeof Product>;

export async function allProducts(db: D1Database, visibleOnly = false): Promise<Product[]> {
  const sql = `SELECT data FROM products${visibleOnly ? " WHERE visible = 1" : ""} ORDER BY num_id`;
  const { results } = await db.prepare(sql).all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as Product);
}

export async function upsertProduct(db: D1Database, p: Product): Promise<{ product: Product; created: boolean }> {
  const clash = await db
    .prepare("SELECT item_id FROM products WHERE (num_id = ? OR slug = ?) AND item_id != ?")
    .bind(p.id, p.slug, p.itemId)
    .first<{ item_id: string }>();
  if (clash) throw new HttpError(409, `id or slug already used by ${clash.item_id}`);
  const existing = await db.prepare("SELECT 1 AS x FROM products WHERE item_id = ?").bind(p.itemId).first();
  try {
    await db
      .prepare(
        `INSERT INTO products (item_id, num_id, slug, visible, data, updated_ts) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET num_id = excluded.num_id, slug = excluded.slug,
         visible = excluded.visible, data = excluded.data, updated_ts = excluded.updated_ts`,
      )
      .bind(p.itemId, p.id, p.slug, p.visible ? 1 : 0, JSON.stringify(p), now())
      .run();
  } catch (err) {
    if (isConstraintError(err)) throw new HttpError(409, "id or slug already used by another product");
    throw err;
  }
  return { product: p, created: existing === null };
}

const itemPath = "/api/admin/products/:itemId{GFT-[A-Z]{3}-[0-9]{3}}";

export const catalogRoutes = new Hono<App>()
  .get("/api/catalog", async (c) => c.json({ products: await allProducts(c.env.DB, true) }))
  .get("/api/admin/products", requireAdmin, async (c) => c.json({ products: await allProducts(c.env.DB) }))
  .put(itemPath, requireAdmin, async (c) => {
    const p = await body(c, Product);
    if (p.itemId !== c.req.param("itemId")) throw new HttpError(422, "itemId in the body must match the URL");
    checkProduct(await getTaxonomy(c.env.DB), p);
    return c.json(await upsertProduct(c.env.DB, p));
  })
  .delete(itemPath, requireAdmin, async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM products WHERE item_id = ?").bind(c.req.param("itemId")).run();
    if (!res.meta.changes) throw new HttpError(404, "No such product");
    return c.json({ deleted: true });
  });
