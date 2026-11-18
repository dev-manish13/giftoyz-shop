import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import { allProducts, catalogRoutes } from "./catalog";
import { baseUrl, codDefault, isHttps, isIndexable, now, type App, type Env } from "./env";
import { HttpError } from "./http";
import { alertRoutes } from "./alerts";
import { mediaRoutes } from "./media";
import { orderRoutes } from "./orders";
import { publicRates } from "./rates";
import { rateRoutes, scheduledRates } from "./ratesync";
import { reviewRoutes, reviewStats, shopRating } from "./reviews";
import { pollShipments, shippingRoutes } from "./shipping";
import { robots } from "./pages";
import { addNonce, API_POLICY, nonce, pagePolicy } from "./security";
import { render, sitemap } from "./seo";
import { getSettings, publicView, settingsRoutes } from "./settings";
import { getTaxonomy, taxonomyRoutes } from "./taxonomy";

const PUBLIC_FILE = /^[a-z0-9][a-z0-9-]*\.(html|js|css|png|jpg|jpeg|webp|avif|svg|ico)$/;
const PAGE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const NO_CACHE = /\.(html|js|css)$/;
const RATES_CRON = "7,22,37,52 * * * *";
const MAX_BODY = 26 * 1024 * 1024;
const NOINDEX_PAGES = new Set(["admin.html", "checkout.html"]);

const app = new Hono<App>();

app.use(trimTrailingSlash());

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const canonical = new URL(c.env.PUBLIC_BASE_URL);
  if (url.hostname === `www.${canonical.hostname}`) {
    return c.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
  }
  await next();
});

app.use("*", async (c, next) => {
  const size = c.req.header("content-length");
  if (size && /^\d+$/.test(size) && Number(size) > MAX_BODY) {
    return c.text("Request too large", 413);
  }
  await next();
  const h = c.res.headers;
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isHttps(c.env)) h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (!isIndexable(c.env)) h.set("X-Robots-Tag", "noindex, nofollow");
  const path = c.req.path;
  if (path.startsWith("/api/") || path.startsWith("/ncm/")) {
    h.set("Cache-Control", "no-store");
    h.set("Content-Security-Policy", API_POLICY);
  }
});

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/robots.txt", (c) => c.text(robots(baseUrl(c.env), isIndexable(c.env))));

app.get("/sitemap.xml", async (c) => {
  const row = await c.env.DB.prepare("SELECT MAX(updated_ts) AS ts FROM products WHERE visible = 1").first<{ ts: number | null }>();
  const body = sitemap(baseUrl(c.env), await allProducts(c.env.DB, true), row?.ts ?? now());
  return c.body(body, 200, { "Content-Type": "application/xml" });
});

app.route("/", mediaRoutes);
app.route("/", catalogRoutes);
app.route("/", taxonomyRoutes);
app.route("/", settingsRoutes);
app.route("/", orderRoutes);
app.route("/", shippingRoutes);
app.route("/", rateRoutes);
app.route("/", reviewRoutes);
app.route("/", alertRoutes);

async function asset(env: Env, url: string, name: string): Promise<Response | null> {
  const res = await env.ASSETS.fetch(new URL(`/${name}`, url));
  return res.ok ? res : null;
}

async function renderPage(env: Env, url: string, name: string): Promise<Response> {
  const res = await asset(env, url, name);
  if (!res) return new Response("Not found", { status: 404 });
  const [catalog, settings, taxonomy, rates] = await Promise.all([
    allProducts(env.DB, true),
    getSettings(env.DB, codDefault(env)),
    getTaxonomy(env.DB),
    publicRates(env.DB),
  ]);
  const shop = publicView(settings);
  const item = new URL(url).searchParams.get("item") ?? "";
  const reviews = name === "product.html" && /^GFT-[A-Z]{3}-\d{3}$/.test(item) ? await reviewStats(env.DB, item) : undefined;
  const rating = name === "index.html" ? await shopRating(env.DB) : undefined;
  const [html, status] = render(await res.text(), {
    page: name,
    query: new URL(url).searchParams,
    base: baseUrl(env),
    catalog,
    settings: shop,
    taxonomy,
    config: { api: true, khalti: false, codAdvance: shop.codAdvance },
    rates: Object.keys(rates).length ? rates : undefined,
    reviews,
    rating,
  });
  const value = nonce();
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": pagePolicy(value, isHttps(env)),
  });
  if (NOINDEX_PAGES.has(name)) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(addNonce(html, value), { status, headers });
}

app.get("/", (c) => renderPage(c.env, c.req.url, "index.html"));

app.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (PAGE_NAME.test(name)) return name === "index" ? c.redirect("/", 301) : renderPage(c.env, c.req.url, `${name}.html`);
  if (!PUBLIC_FILE.test(name)) return c.notFound();
  if (name.endsWith(".html")) {
    const page = name.slice(0, -5);
    return c.redirect(`/${page === "index" ? "" : page}${new URL(c.req.url).search}`, 301);
  }
  const res = await asset(c.env, c.req.url, name);
  if (!res) return c.notFound();
  const cache = NO_CACHE.test(name)
    ? new URL(c.req.url).searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache"
    : "public, max-age=86400";
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", cache);
  return out;
});

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ detail: "Not Found" }, 404) : c.text("Not found", 404)));
app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ detail: err.detail }, err.status as 400, err.headers);
  }
  console.error(err);
  return c.text("Server error", 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === RATES_CRON) {
      ctx.waitUntil(scheduledRates(env));
    } else {
      ctx.waitUntil(pollShipments(env).then((n) => n && console.log(`Checked ${n} NCM shipments`)));
    }
  },
} satisfies ExportedHandler<Env>;
