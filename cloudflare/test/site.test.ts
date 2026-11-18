
import { describe, expect, it } from "vitest";

import { SELF } from "cloudflare:test";
import { get } from "./helpers";

const SELF_FETCH = (url: string) => SELF.fetch(url, { redirect: "manual" });

describe("static site", () => {
  it("serves the home page with a nonce on every script", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const value = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(value).toBeTruthy();
    const html = await res.text();
    const scripts = html.match(/<script(?=[\s>])[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${value}"`);
    expect(html).toContain("window.GT_CONFIG=");
  });

  it("gives each response a fresh nonce", async () => {
    const a = (await get("/about")).headers.get("Content-Security-Policy");
    const b = (await get("/about")).headers.get("Content-Security-Policy");
    expect(a).not.toEqual(b);
  });

  it("sets security headers", async () => {
    const res = await get("/products");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("marks admin and checkout noindex", async () => {
    for (const page of ["/admin", "/checkout"]) {
      expect((await get(page)).headers.get("X-Robots-Tag")).toContain("noindex");
    }
  });

  it("serves versioned assets as immutable and others as no-cache", async () => {
    expect((await get("/app.js?v=abc")).headers.get("Cache-Control")).toContain("immutable");
    expect((await get("/app.js")).headers.get("Cache-Control")).toBe("no-cache");
    expect((await get("/logo.png")).headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it.each([
    "/.env",
    "/server/.env",
    "/server/app/main.py",
    "/CLAUDE.md",
    "/REBUILD.md",
    "/build/pages.py",
    "/cloudflare/wrangler.toml",
    "/wrangler.toml",
    "/Index.html",
    "/missing",
    "/Products",
    "/%2e%2e/server/.env",
  ])("refuses %s", async (path) => {
    expect((await get(path)).status).toBe(404);
  });

  it("rejects oversized requests", async () => {
    const res = await get("/", { headers: { "content-length": String(27 * 1024 * 1024) } });
    expect(res.status).toBe(413);
  });

  it("blocks indexing on the test address", async () => {
    const res = await get("/robots.txt");
    expect(await res.text()).toContain("Disallow: /");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("refuses form posts from other sites", async () => {
    const res = await get("/api/orders", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    expect(res.status).toBe(415);
  });

  it("sends www to the main address", async () => {
    const res = await SELF_FETCH("https://www.giftoyz.test/about?x=1");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://giftoyz.test/about?x=1");
  });

  it.each([
    ["/index.html", "/"],
    ["/index", "/"],
    ["/products.html?cat=plush", "/products?cat=plush"],
    ["/product.html?item=GFT-TUM-001", "/product?item=GFT-TUM-001"],
    ["/admin.html", "/admin"],
    ["/products/", "/products"],
  ])("redirects %s to %s", async (from, to) => {
    const res = await get(from, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("Location")!, "https://giftoyz.test").href).toBe(`https://giftoyz.test${to}`);
  });

  it("serves pages at clean addresses", async () => {
    for (const page of ["/", "/products", "/product", "/track", "/about", "/help", "/contact"]) {
      const res = await get(page, { redirect: "manual" });
      expect(res.status).toBe(200);
      expect(await res.text()).not.toMatch(/href="[a-z-]+\.html/);
    }
  });

  it("answers health checks", async () => {
    expect(await (await get("/healthz")).json()).toEqual({ status: "ok" });
  });
});
