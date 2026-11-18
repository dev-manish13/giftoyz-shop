import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { admin, get, product, reset } from "./helpers";
import { parcelKg, weightedFee } from "../src/rates";

let ip = 0;
const order = (overrides: Record<string, unknown> = {}) =>
  get("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.2.0.${++ip % 250}` },
    body: JSON.stringify({
      items: [{ id: 1, color: "black", qty: 2 }],
      name: "Sita Sharma",
      phone: "9812345678",
      location_key: "tinkune",
      delivery: "home",
      address: "Baneshwor, near the temple",
      mode: "cod",
      ...overrides,
    }),
  });

type Created = { order: any; token: string };
const stock = async () => {
  const { products } = (await (await admin("/api/admin/products")).json()) as { products: { stock: number }[] };
  return products[0]!.stock;
};

beforeEach(async () => {
  await reset();
  await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ stock: 3 }));
});

describe("orders", () => {
  it("prices on the server, takes the delivery fee upfront for COD and holds stock", async () => {
    const res = await order({ items: [{ id: 1, color: "black", qty: 2 }] });
    expect(res.status).toBe(200);
    const { order: o, token } = (await res.json()) as Created;
    const rate = await env.DB.prepare("SELECT home FROM rates WHERE key = 'TINKUNE'").first<{ home: number }>();
    expect(o.id).toMatch(/^GT-\d{6}-\d{4}$/);
    expect(o.subtotal).toBe(2400);
    expect(o.location).toMatchObject({ key: "TINKUNE", name: "Tinkune", fee: rate!.home, type: "home" });
    expect(o.payment).toMatchObject({ mode: "cod", paidNow: rate!.home, due: 2400, verified: false });
    expect(o.status).toBe("payment_pending");
    expect(token.length).toBeGreaterThan(20);
    expect(await stock()).toBe(1);
    const row = await env.DB.prepare("SELECT data, phone_digest, token_digest FROM orders").first<{ data: string; phone_digest: string; token_digest: string }>();
    expect(row!.phone_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(row!.phone_digest).not.toContain("9812345678");
    expect(row!.token_digest).not.toBe(token);
  });

  it("is received without upfront payment when COD advance is off", async () => {
    await admin("/api/admin/settings", "PUT", { codAdvance: false });
    const { order: o } = (await (await order()).json()) as Created;
    expect(o.status).toBe("received");
    expect(o.payment.paidNow).toBe(0);
    expect(o.payment.wallet).toBeNull();
  });

  it("charges the branch fee for pickup and the full amount when paying now", async () => {
    const rate = await env.DB.prepare("SELECT home, branch FROM rates WHERE key = 'TINKUNE'").first<{ home: number; branch: number }>();
    const { order: o } = (await (await order({ delivery: "branch", mode: "full", wallet: "bank", txn: "ABC123" })).json()) as Created;
    expect(o.location.fee).toBe(rate!.branch);
    expect(o.payment).toMatchObject({ paidNow: o.total, due: 0, wallet: "bank" });
  });

  it("charges NCM's weight rate for parcels over 2 kg", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ stock: 3, weight_kg: 1.6 }));
    const rate = await env.DB.prepare("SELECT home FROM rates WHERE key = 'TINKUNE'").first<{ home: number }>();
    const { order: o } = (await (await order({ items: [{ id: 1, color: "black", qty: 2 }] })).json()) as Created;
    expect(o.location.fee).toBe(Math.round(rate!.home * 2.2));
    expect(o.payment.paidNow).toBe(o.location.fee);
    expect(o.total).toBe(o.subtotal + o.location.fee);
  });

  it("matches NCM's own prices for heavy parcels", () => {
    const samples: [number, number, number][] = [[120, 2, 120], [120, 2.2, 144], [120, 2.5, 180], [120, 4, 360], [120, 7.3, 756], [70, 2.5, 105], [170, 3, 340], [170, 10, 1530], [120, 10, 1080]];
    for (const [base, kg, ncm] of samples) expect(weightedFee(base, kg)).toBe(ncm);
    expect(parcelKg([{ weight_kg: 0.4, qty: 3 }, { qty: 1 }])).toBe(1.7);
  });

  it("refuses more than the stock, even across lines", async () => {
    const res = await order({ items: [{ id: 1, color: "black", qty: 2 }, { id: 1, color: "black", qty: 2 }] });
    expect(res.status).toBe(409);
    expect(await stock()).toBe(3);
  });

  it("never oversells when two orders race", async () => {
    const [a, b] = await Promise.all([order({ items: [{ id: 1, color: "black", qty: 2 }] }), order({ items: [{ id: 1, color: "black", qty: 2 }] })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await stock()).toBe(1);
  });

  it("rejects bad input", async () => {
    expect((await order({ location_key: "moon" })).status).toBe(422);
    expect((await order({ items: [{ id: 1, color: "pink", qty: 1 }] })).status).toBe(422);
    expect((await order({ items: [{ id: 99, color: "black", qty: 1 }] })).status).toBe(409);
    expect((await order({ phone: "12345" })).status).toBe(422);
    expect((await order({ price: 1 })).status).toBe(422);
    expect((await order({ items: [{ id: 1, color: "black", qty: 1, price: 1 }] })).status).toBe(422);
  });

  it("refuses orders while paused", async () => {
    await admin("/api/admin/settings", "PUT", { orders_paused: true, pause_en: "Back on Sunday." });
    const res = await order();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ detail: "Back on Sunday." });
  });

  it("limits orders per connection", async () => {
    await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ stock: 100 }));
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const res = await get("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.3.3.3" },
        body: JSON.stringify({ items: [{ id: 1, color: "black", qty: 1 }], name: "Ram", phone: "9812345678", location_key: "tinkune", delivery: "home", address: "Baneshwor, Kathmandu", mode: "cod" }),
      });
      codes.push(res.status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("hides bills until the owner turns them on", async () => {
    const { order: o, token } = (await (await order()).json()) as Created;
    expect((await get(`/invoice/${o.id}?token=${token}`)).status).toBe(404);
  });

  it("shows the order and bill only with the token", async () => {
    await admin("/api/admin/settings", "PUT", { bills_enabled: true });
    const { order: o, token } = (await (await order()).json()) as Created;
    expect((await get(`/api/orders/${o.id}?token=${token}`)).status).toBe(200);
    const bad = "x".repeat(32);
    expect((await get(`/api/orders/${o.id}?token=${bad}`)).status).toBe(404);
    expect((await get(`/api/orders/${o.id}`)).status).toBe(422);
    const bill = await get(`/invoice/${o.id}?token=${token}`);
    expect(bill.status).toBe(200);
    expect(bill.headers.get("Cache-Control")).toBe("no-store");
    const html = await bill.text();
    expect(html).toContain("Sita Sharma");
    expect(html).toContain("Rs 2,400");
    const value = /'nonce-([^']+)'/.exec(bill.headers.get("Content-Security-Policy") ?? "")?.[1];
    expect(html).toContain(`<script nonce="${value}">`);
    expect((await get(`/invoice/${o.id}?token=${bad}`)).status).toBe(404);
  });

  it("escapes customer text on the bill", async () => {
    await admin("/api/admin/settings", "PUT", { bills_enabled: true });
    const { order: o, token } = (await (await order({ name: "<img src=x onerror=alert(1)>" })).json()) as Created;
    const html = await (await get(`/invoice/${o.id}?token=${token}`)).text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("admin orders", () => {
  it("lists orders for the admin only", async () => {
    await order();
    expect((await get("/api/admin/orders")).status).toBe(401);
    const { orders } = (await (await admin("/api/admin/orders")).json()) as { orders: any[] };
    expect(orders).toHaveLength(1);
    expect(orders[0].phone).toBe("9812345678");
  });

  it("confirms payment and follows allowed steps only", async () => {
    const { order: o } = (await (await order()).json()) as Created;
    let res = await admin(`/api/admin/orders/${o.id}/status`, "POST", { status: "delivered" });
    expect(res.status).toBe(409);
    res = await admin(`/api/admin/orders/${o.id}/status`, "POST", { status: "confirmed" });
    const { order: confirmed } = (await res.json()) as { order: any };
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.payment.verified).toBe(true);
    expect(confirmed.history.map((h: any) => h.status)).toEqual(["payment_pending", "confirmed"]);
  });

  it("returns stock when an order is cancelled", async () => {
    const { order: o } = (await (await order()).json()) as Created;
    expect(await stock()).toBe(1);
    await admin(`/api/admin/orders/${o.id}/status`, "POST", { status: "cancelled" });
    expect(await stock()).toBe(3);
    expect((await admin(`/api/admin/orders/${o.id}/status`, "POST", { status: "cancelled" })).status).toBe(409);
    expect(await stock()).toBe(3);
  });

  it("injects the rate card into pages", async () => {
    const html = await (await get("/checkout")).text();
    expect(html).toContain('window.GT_RATES={"');
  });
});
