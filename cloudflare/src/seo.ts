import type { Product } from "./catalog";
import type { ReviewStats } from "./reviews";
import { scriptJson } from "./pages";
import type { ShopSettings } from "./settings";
import type { Taxonomy } from "./taxonomy";

type Json = Record<string, unknown>;

export const STATIC_PAGES = ["", "products", "track", "about", "help", "contact"];
const BRAND = "GifToyz Nepal";
const DEFAULT_IMAGE = "about-cover-1024.jpg";
const PAYMENTS = "Pay by eSewa, bank QR or cash on delivery.";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => ESC[ch]!);
const UNESC: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" };
const unesc = (v: string) => v.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, k: string) => UNESC[k]!);

const jsonLd = (data: Json) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/<\//g, "<\\/")}</script>`;

export const productUrl = (base: string, p: Product) => `${base}/product?item=${p.itemId}`;
const imageUrl = (base: string, img: { src: string }, width = 1200) => `${base}${img.src}-${width}.jpg`;
const rs = (n: number) => n.toLocaleString("en-US");

class PageMeta {
  image = "";
  imageSize: [number, number] = [1200, 1500];
  ogType = "website";
  noindex = false;
  jsonLd: Json[] = [];
  constructor(public title: string, public description: string, public canonical: string) {}

  tags(): string {
    const parts = [
      `<link rel="canonical" href="${esc(this.canonical)}">`,
      `<meta property="og:site_name" content="${BRAND}">`,
      `<meta property="og:type" content="${this.ogType}">`,
      `<meta property="og:title" content="${esc(this.title)}">`,
      `<meta property="og:description" content="${esc(this.description)}">`,
      `<meta property="og:url" content="${esc(this.canonical)}">`,
      '<meta property="og:locale" content="en_NP">',
      '<meta property="og:locale:alternate" content="ne_NP">',
      `<meta name="twitter:card" content="${this.image ? "summary_large_image" : "summary"}">`,
      `<meta name="twitter:title" content="${esc(this.title)}">`,
      `<meta name="twitter:description" content="${esc(this.description)}">`,
    ];
    if (this.image) {
      parts.push(
        `<meta property="og:image" content="${esc(this.image)}">`,
        `<meta property="og:image:width" content="${this.imageSize[0]}">`,
        `<meta property="og:image:height" content="${this.imageSize[1]}">`,
        `<meta property="og:image:alt" content="${esc(this.title)}">`,
        `<meta name="twitter:image" content="${esc(this.image)}">`,
      );
    }
    if (this.noindex) parts.push('<meta name="robots" content="noindex">');
    parts.push(...this.jsonLd.map(jsonLd));
    return parts.join("\n");
  }
}

const breadcrumbs = (trail: [string, string][]): Json => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
});

function storeLd(base: string, s: ShopSettings, sameAs: string[]): Json {
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: BRAND,
    url: `${base}/`,
    logo: `${base}/icon-512.png`,
    image: `${base}/${DEFAULT_IMAGE}`,
    description: "Online gift shop in Nepal for teddies, plush toys and tumblers, delivered to 300+ places by Nepal Can Move.",
    address: { "@type": "PostalAddress", streetAddress: "New Road", addressLocality: "Kathmandu", addressCountry: "NP" },
    priceRange: "Rs",
    telephone: `+977-${s.phone}`,
    areaServed: "Nepal",
    currenciesAccepted: "NPR",
    paymentAccepted: "Cash, eSewa, Bank transfer",
    sameAs: sameAs.length ? sameAs : ["https://www.instagram.com/giftoyz.np/"],
  };
  if (s.email) data.email = s.email;
  return data;
}

function productLd(base: string, p: Product, catNames: Map<string, string>, reviews?: ReviewStats): Json {
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.itemId,
    description: p.blurb || p.name,
    brand: { "@type": "Brand", name: "GifToyz" },
    category: catNames.get(p.cat) ?? p.cat,
    url: productUrl(base, p),
    image: p.images.map((img) => imageUrl(base, img)),
  };
  if (reviews?.count) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: String(reviews.average), reviewCount: reviews.count, bestRating: "5", worstRating: "1" };
    data.review = reviews.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.name },
      datePublished: r.at.slice(0, 10),
      reviewBody: r.body,
      reviewRating: { "@type": "Rating", ratingValue: String(r.stars), bestRating: "5", worstRating: "1" },
    }));
  }
  if (p.price) {
    data.offers = {
      "@type": "Offer",
      priceCurrency: "NPR",
      price: String(p.price),
      availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url: productUrl(base, p),
      seller: { "@type": "Organization", name: BRAND },
    };
  }
  return data;
}

export interface RenderInput {
  page: string;
  query: URLSearchParams;
  base: string;
  catalog: Product[];
  settings: ShopSettings;
  taxonomy: Taxonomy;
  config: Json;
  rates?: unknown;
  reviews?: ReviewStats;
  rating?: { count: number; average: number };
}

function metaFor(i: RenderInput, title: string, desc: string, catNames: Map<string, string>): [PageMeta, number] {
  const { page, base, settings: s } = i;
  const meta = new PageMeta(title, desc, `${base}/${page === "index.html" ? "" : page.replace(/\.html$/, "")}`);
  if (page === "index.html") {
    const sameAs = [
      s.instagram && `https://www.instagram.com/${s.instagram}/`,
      s.tiktok && `https://www.tiktok.com/@${s.tiktok}`,
      s.facebook && `https://www.facebook.com/${s.facebook}`,
    ].filter((u): u is string => Boolean(u));
    meta.jsonLd.push(storeLd(base, s, sameAs));
  } else if (page === "products.html") {
    const cat = i.query.get("cat") ?? "";
    const trail: [string, string][] = [["Home", `${base}/`], ["Shop", `${base}/products`]];
    const name = catNames.get(cat);
    if (name) {
      meta.title = `${name} | ${BRAND}`;
      meta.description = `Shop ${name.toLowerCase()} online in Nepal with delivery to 300+ places through NCM. ${PAYMENTS}`;
      meta.canonical = `${base}/products?cat=${encodeURIComponent(cat)}`;
      trail.push([name, meta.canonical]);
    }
    meta.jsonLd.push(breadcrumbs(trail));
  } else if (page === "product.html") {
    const item = i.query.get("item") ?? "";
    const p = i.catalog.find((x) => x.itemId === item);
    if (!p) {
      meta.noindex = true;
      return [meta, item ? 404 : 200];
    }
    meta.title = `${p.name} | ${BRAND}`;
    const blurb = p.blurb || p.name;
    meta.description = (p.price ? `Rs ${rs(p.price)}. ${blurb}` : blurb).slice(0, 300);
    meta.canonical = productUrl(base, p);
    meta.ogType = "product";
    if (p.images[0]) meta.image = imageUrl(base, p.images[0]);
    meta.jsonLd.push(productLd(base, p, catNames, i.reviews));
    meta.jsonLd.push(
      breadcrumbs([
        ["Home", `${base}/`],
        [catNames.get(p.cat) ?? "Shop", `${base}/products?cat=${p.cat}`],
        [p.name, meta.canonical],
      ]),
    );
  }
  return [meta, 200];
}

const TITLE = /<title>([\s\S]*?)<\/title>/;
const DESC = /<meta name="description" content="([^"]*)">/;
const STATIC_LD = /<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g;
const DATA_JS = /<script src="data\.js[^"]*"><\/script>/;

export function render(html: string, i: RenderInput): [string, number] {
  const title = TITLE.exec(html)?.[1];
  const desc = DESC.exec(html)?.[1];
  const catNames = new Map(i.taxonomy.categories.map((c) => [c.id, c.en]));
  const [meta, status] = metaFor(i, title ? unesc(title) : BRAND, desc ? unesc(desc) : "", catNames);
  if (!meta.image) {
    meta.image = `${i.base}/${DEFAULT_IMAGE}`;
    meta.imageSize = [1024, 1024];
  }
  let out = html.replace(STATIC_LD, "");
  out = out.replace(TITLE, () => `<title>${esc(meta.title)}</title>`);
  out = out.replace(DESC, () => `<meta name="description" content="${esc(meta.description)}">`);
  out = out.replace("</head>", () => `${meta.tags()}\n</head>`);
  const boot =
    scriptJson("GT_CATALOG", i.catalog) +
    scriptJson("GT_CONFIG", i.config) +
    scriptJson("GT_SETTINGS", i.settings) +
    scriptJson("GT_TAXONOMY", i.taxonomy) +
    (i.rates ? scriptJson("GT_RATES", i.rates) : "") +
    (i.reviews ? scriptJson("GT_REVIEWS", i.reviews) : "") +
    (i.rating ? scriptJson("GT_RATING", i.rating) : "");
  out = out.replace(DATA_JS, (tag) => `${boot}\n${tag}`);
  return [out, status];
}

export function sitemap(base: string, catalog: Product[], updated: number): string {
  const day = new Date(updated * 1000).toISOString().slice(0, 10);
  const urls: [string, string][] = STATIC_PAGES.map((p) => [`${base}/${p}`, p === "" || p === "products" ? "weekly" : "monthly"]);
  for (const c of [...new Set(catalog.map((p) => p.cat))].sort()) urls.push([`${base}/products?cat=${c}`, "weekly"]);
  for (const p of catalog) urls.push([productUrl(base, p), "weekly"]);
  const body = urls
    .map(([u, f]) => `<url><loc>${esc(u)}</loc><lastmod>${day}</lastmod><changefreq>${f}</changefreq></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`;
}
