import { beforeEach, describe, expect, it } from "vitest";
import { admin, get, product, reset } from "./helpers";

beforeEach(reset);

describe("admin auth", () => {
  it("rejects a missing or wrong key", async () => {
    expect((await get("/api/admin/products")).status).toBe(401);
    const res = await get("/api/admin/products", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: "Wrong admin key" });
  });

  it("locks out after five wrong keys per minute", async () => {
    const wrong = { headers: { Authorization: "Bearer wrong", "CF-Connecting-IP": "10.9.9.9" } };
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await get("/api/admin/products", wrong)).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("accepts the right key", async () => {
    expect((await admin("/api/admin/products")).status).toBe(200);
  });
});

describe("products", () => {
  it("creates, lists, updates and deletes", async () => {
    let res = await admin("/api/admin/products/GFT-TUM-001", "PUT", product());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: true, product: { itemId: "GFT-TUM-001", compare: 0, ne_name: "" } });
    res = await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ price: 1100 }));
    expect(await res.json()).toMatchObject({ created: false, product: { price: 1100 } });
    const pub = (await (await get("/api/catalog")).json()) as { products: unknown[] };
    expect(pub.products).toHaveLength(1);
    expect((await admin("/api/admin/products/GFT-TUM-001", "DELETE")).status).toBe(200);
    expect((await admin("/api/admin/products/GFT-TUM-001", "DELETE")).status).toBe(404);
  });

  it("hides invisible products from the shop", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ visible: false }));
    const pub = (await (await get("/api/catalog")).json()) as { products: unknown[] };
    expect(pub.products).toHaveLength(0);
    const all = (await (await admin("/api/admin/products")).json()) as { products: unknown[] };
    expect(all.products).toHaveLength(1);
  });

  it("needs a price to be visible", async () => {
    expect((await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ price: null }))).status).toBe(422);
  });

  it("drops a compare price that isn't higher", async () => {
    const res = await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ compare: 1000 }));
    expect(((await res.json()) as { product: { compare: number } }).product.compare).toBe(0);
  });

  it("rejects unknown fields, bad ids and mismatched URLs", async () => {
    expect((await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ hack: 1 }))).status).toBe(422);
    expect((await admin("/api/admin/products/GFT-TUM-002", "PUT", product())).status).toBe(422);
    expect((await admin("/api/admin/products/BAD", "PUT", product())).status).toBe(404);
    const res = await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ images: [{ src: "/etc/passwd", w: 1, h: 1, kind: "hero", alt: "xxx" }] }));
    expect(res.status).toBe(422);
  });

  it("checks category code, colours and occasions", async () => {
    expect((await admin("/api/admin/products/GFT-BOT-001", "PUT", product({ itemId: "GFT-BOT-001" }))).status).toBe(422);
    expect((await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ colors: ["plaid"] }))).status).toBe(422);
    expect((await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ occasions: ["diwali"] }))).status).toBe(422);
  });

  it("refuses a slug or number already used", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product());
    const res = await admin("/api/admin/products/GFT-TUM-002", "PUT", product({ itemId: "GFT-TUM-002", id: 2 }));
    expect(res.status).toBe(409);
  });
});

describe("taxonomy", () => {
  it("serves defaults and saves edits", async () => {
    const { taxonomy } = (await (await get("/api/taxonomy")).json()) as { taxonomy: { categories: { id: string }[] } };
    expect(taxonomy.categories.map((c) => c.id)).toContain("tumblers");
    const edited = { ...taxonomy, categories: [{ id: "lamps", en: "Lamps", code: "LAM" }] };
    const res = await admin("/api/admin/taxonomy", "PUT", { ...edited, colors: [{ id: "black", en: "Black", hex: "#000000" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ taxonomy: { categories: [{ id: "lamps", art: "giftbox", ne: "" }] } });
  });

  it("protects categories, colours and codes in use", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product());
    const { taxonomy } = (await (await get("/api/taxonomy")).json()) as { taxonomy: any };
    const noTumblers = { ...taxonomy, categories: taxonomy.categories.filter((c: any) => c.id !== "tumblers") };
    expect((await admin("/api/admin/taxonomy", "PUT", noTumblers)).status).toBe(409);
    const newCode = { ...taxonomy, categories: taxonomy.categories.map((c: any) => (c.id === "tumblers" ? { ...c, code: "TMB" } : c)) };
    expect((await admin("/api/admin/taxonomy", "PUT", newCode)).status).toBe(409);
  });

  it("rejects duplicate ids and codes", async () => {
    const { taxonomy } = (await (await get("/api/taxonomy")).json()) as { taxonomy: any };
    const dup = { ...taxonomy, categories: [...taxonomy.categories, { ...taxonomy.categories[0], id: "other" }] };
    expect((await admin("/api/admin/taxonomy", "PUT", dup)).status).toBe(422);
  });
});

describe("settings", () => {
  it("fills defaults and strips control characters", async () => {
    const res = await admin("/api/admin/settings", "PUT", { announce_en: "  Dashain\u0007  sale​ now ", unknown: 1 });
    const { settings } = (await res.json()) as { settings: any };
    expect(settings.announce_en).toBe("Dashain sale now");
    expect(settings.phone).toBe("9709119177");
    expect(settings.codAdvance).toBe(true);
    expect(settings).not.toHaveProperty("unknown");
  });

  it("rejects bad links and QR paths", async () => {
    expect((await admin("/api/admin/settings", "PUT", { qr: { esewa: "/evil.png" } })).status).toBe(422);
    const banner = { id: "abcdef12", image: { src: "/media/products/b-0123456789ab", w: 2400, h: 800 }, link: "javascript:alert(1)" };
    expect((await admin("/api/admin/settings", "PUT", { banners: [banner] })).status).toBe(422);
  });

  it("stores the home showcase picks", async () => {
    const hero = [{ id: 4, label: "hot" }, { id: 9 }];
    const res = await admin("/api/admin/settings", "PUT", { hero });
    expect(((await res.json()) as any).settings.hero).toEqual([{ id: 4, label: "hot" }, { id: 9, label: "" }]);
    const pub = (await (await get("/api/settings")).json()) as { settings: { hero: unknown[] } };
    expect(pub.settings.hero).toHaveLength(2);
    expect((await admin("/api/admin/settings", "PUT", { hero: [{ id: 1, label: "sale" }] })).status).toBe(422);
    expect((await admin("/api/admin/settings", "PUT", { hero: [1, 2, 3, 4].map((id) => ({ id })) })).status).toBe(422);
  });

  it("shows only current banners to the public", async () => {
    const image = { src: "/media/products/b-0123456789ab", w: 2400, h: 800 };
    const banners = [
      { id: "aaaaaaaa", image },
      { id: "bbbbbbbb", image, active: false },
      { id: "cccccccc", image, ends: "2000-01-01" },
    ];
    await admin("/api/admin/settings", "PUT", { banners });
    const pub = (await (await get("/api/settings")).json()) as { settings: { banners: { id: string }[] } };
    expect(pub.settings.banners.map((b) => b.id)).toEqual(["aaaaaaaa"]);
    await admin("/api/admin/settings", "PUT", { banners, banners_enabled: false });
    const off = (await (await get("/api/settings")).json()) as { settings: { banners: unknown[] } };
    expect(off.settings.banners).toEqual([]);
  });
});

describe("pages", () => {
  it("renders product SEO and boot data", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ name: 'Tumbler "Pro" </script>' }));
    const res = await get("/product?item=GFT-TUM-001");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Tumbler &quot;Pro&quot; &lt;/script&gt; | GifToyz Nepal</title>");
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain("Rs 1,200.");
    expect(html).not.toContain('Pro" </script>');
    expect(html).toContain("window.GT_CATALOG=");
    expect(html).toContain("window.GT_TAXONOMY=");
  });

  it("returns 404 and noindex for an unknown product", async () => {
    const res = await get("/product?item=GFT-TUM-999");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<meta name="robots" content="noindex">');
  });

  it("lists visible products in the sitemap", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product());
    const xml = await (await get("/sitemap.xml")).text();
    expect(xml).toContain("product?item=GFT-TUM-001");
    expect(xml).toContain("products?cat=tumblers");
  });

  it("returns JSON 404 for unknown API paths with no-store", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
