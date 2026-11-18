import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "./auth";
import type { App } from "./env";
import { body, clean, HttpError } from "./http";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
export const ARTS = ["tumbler", "bottle", "giftbox", "teddy", "mug", "hamper"] as const;

const named = {
  id: z.string().trim().max(40).regex(SLUG),
  en: z.string().trim().min(1).max(40).transform(clean),
  ne: z.string().trim().max(60).default("").transform(clean),
};

const Category = z.strictObject({
  ...named,
  code: z.string().trim().regex(/^[A-Z]{3}$/),
  art: z.enum(ARTS).default("giftbox"),
  color: z.string().trim().regex(HEX).default("#F86808"),
});
const Colour = z.strictObject({ ...named, hex: z.string().trim().regex(HEX) });
const Occasion = z.strictObject(named);

export const Taxonomy = z
  .strictObject({
    categories: z.array(Category).min(1).max(40),
    colors: z.array(Colour).min(1).max(60),
    occasions: z.array(Occasion).max(40).default([]),
  })
  .superRefine((t, ctx) => {
    for (const [name, items] of [["category", t.categories], ["colour", t.colors], ["occasion", t.occasions]] as const) {
      const ids = items.map((i) => i.id);
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `Two ${name} entries have the same id` });
    }
    const codes = t.categories.map((c) => c.code);
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: "custom", message: "Two categories use the same item code" });
  });
export type Taxonomy = z.output<typeof Taxonomy>;

export const DEFAULT_TAXONOMY: Taxonomy = {
  categories: [
    { id: "tumblers", en: "Tumblers", ne: "टम्बलर", code: "TUM", art: "tumbler", color: "#1E1E1E" },
    { id: "bottles", en: "Bottles", ne: "बोतल", code: "BOT", art: "bottle", color: "#F86808" },
    { id: "gift-boxes", en: "Gift boxes", ne: "गिफ्ट बक्स", code: "BOX", art: "giftbox", color: "#F86808" },
    { id: "teddies", en: "Teddies", ne: "टेडी", code: "TED", art: "teddy", color: "#C47A3D" },
    { id: "mugs", en: "Mugs", ne: "मग", code: "MUG", art: "mug", color: "#FFFFFF" },
    { id: "plush", en: "Plush toys", ne: "सफ्ट ट्वाय", code: "PLU", art: "teddy", color: "#A9CDEB" },
  ],
  colors: [
    { id: "black", en: "Midnight black", ne: "कालो", hex: "#1E1E1E" },
    { id: "orange", en: "Sunset orange", ne: "सुन्तला", hex: "#F86808" },
    { id: "cream", en: "Cream", ne: "क्रिम", hex: "#F1E4CF" },
    { id: "mint", en: "Mint", ne: "मिन्ट हरियो", hex: "#A8DCC6" },
    { id: "pink", en: "Blush pink", ne: "गुलाबी", hex: "#F5B8C6" },
    { id: "lilac", en: "Lilac", ne: "हल्का बैजनी", hex: "#CDBBF0" },
    { id: "white", en: "White", ne: "सेतो", hex: "#FFFFFF" },
    { id: "brown", en: "Honey brown", ne: "खैरो", hex: "#C47A3D" },
    { id: "sky", en: "Sky blue", ne: "आकाशे नीलो", hex: "#A9CDEB" },
    { id: "red", en: "Red", ne: "रातो", hex: "#C8202F" },
    { id: "yellow", en: "Yellow", ne: "पहेँलो", hex: "#F5D33B" },
    { id: "blue", en: "Blue", ne: "नीलो", hex: "#3F6FB5" },
  ],
  occasions: [],
};

export async function getTaxonomy(db: D1Database): Promise<Taxonomy> {
  const row = await db.prepare("SELECT data FROM taxonomy WHERE id = 1").first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Taxonomy) : DEFAULT_TAXONOMY;
}

type Usage = Record<"category" | "colour" | "occasion", Map<string, number>>;

async function usage(db: D1Database): Promise<Usage> {
  const out: Usage = { category: new Map(), colour: new Map(), occasion: new Map() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const { results } = await db.prepare("SELECT data FROM products").all<{ data: string }>();
  for (const row of results) {
    const p = JSON.parse(row.data) as { cat: string; colors?: string[]; occasions?: string[] };
    bump(out.category, p.cat);
    for (const c of p.colors ?? []) bump(out.colour, c);
    for (const o of p.occasions ?? []) bump(out.occasion, o);
  }
  return out;
}

export async function putTaxonomy(db: D1Database, value: Taxonomy): Promise<Taxonomy> {
  const used = await usage(db);
  const old = await getTaxonomy(db);
  const oldCodes = new Map(old.categories.map((c) => [c.id, c.code]));
  const problems: string[] = [];
  for (const [kind, items] of [["category", value.categories], ["colour", value.colors], ["occasion", value.occasions]] as const) {
    const kept = new Set(items.map((i) => i.id));
    for (const [id, count] of used[kind]) {
      if (!kept.has(id)) problems.push(`${count} product(s) still use the ${kind} '${id}'`);
    }
  }
  for (const c of value.categories) {
    const was = oldCodes.get(c.id);
    if (was !== undefined && was !== c.code && used.category.get(c.id)) {
      problems.push(`Item code of '${c.en}' can't change while products use it`);
    }
  }
  if (problems.length) {
    throw new HttpError(409, `${problems.slice(0, 5).join("; ")}. Move or delete those products first.`);
  }
  await db
    .prepare("INSERT INTO taxonomy (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .bind(JSON.stringify(value))
    .run();
  return value;
}

export function checkProduct(tax: Taxonomy, p: { itemId: string; cat: string; colors: string[]; occasions: string[] }): void {
  const cat = tax.categories.find((c) => c.id === p.cat);
  if (!cat) throw new HttpError(422, `unknown category ${p.cat}`);
  if (p.itemId.slice(4, 7) !== cat.code) throw new HttpError(422, `itemId for ${p.cat} must start with GFT-${cat.code}-`);
  const colours = new Set(tax.colors.map((c) => c.id));
  const badColours = p.colors.filter((c) => !colours.has(c)).sort();
  if (badColours.length) throw new HttpError(422, `unknown colours ${JSON.stringify(badColours)}`);
  const occasions = new Set(tax.occasions.map((o) => o.id));
  const badOccasions = p.occasions.filter((o) => !occasions.has(o)).sort();
  if (badOccasions.length) throw new HttpError(422, `unknown occasions ${JSON.stringify(badOccasions)}`);
}

export const taxonomyRoutes = new Hono<App>()
  .get("/api/taxonomy", async (c) => c.json({ taxonomy: await getTaxonomy(c.env.DB) }))
  .put("/api/admin/taxonomy", requireAdmin, async (c) =>
    c.json({ taxonomy: await putTaxonomy(c.env.DB, await body(c, Taxonomy)) }),
  );
