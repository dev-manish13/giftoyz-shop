import { env, SELF } from "cloudflare:test";

export const ADMIN = "test-admin-key-for-local-preview-only-000";

export const get = (path: string, init?: RequestInit) => SELF.fetch(`https://giftoyz.test${path}`, init);

export function admin(path: string, method = "GET", body?: unknown, ip = "10.0.0.1") {
  return get(path, {
    method,
    headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function reset() {
  await env.DB.batch(
    ["orders", "products", "taxonomy", "shop_settings", "rate_limits", "shipments", "jobs", "rate_sync", "webhook_events", "ncm_events", "reviews", "app_kv"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

export function product(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "GFT-TUM-001",
    id: 1,
    slug: "steel-tumbler",
    name: "Steel tumbler",
    cat: "tumblers",
    art: "tumbler",
    price: 1200,
    stock: 4,
    colors: ["black"],
    occasions: [],
    blurb: "Keeps tea hot for 6 hours.",
    images: [{ src: "/media/products/u-abc123abc123", w: 1200, h: 1500, kind: "hero", alt: "Steel tumbler" }],
    visible: true,
    ...overrides,
  };
}
