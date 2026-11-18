import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { admin, get, product, reset } from "./helpers";

let n = 0;
async function deliveredOrder(phone = "9812345678") {
  const res = await get("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.7.0.${++n}` },
    body: JSON.stringify({ items: [{ id: 1, color: "black", qty: 1 }], name: "Sita", phone, location_key: "tinkune", delivery: "home", address: "Tinkune 32", mode: "cod" }),
  });
  const { order } = (await res.json()) as { order: any };
  await env.DB.prepare("UPDATE orders SET status = 'delivered', data = json_set(data, '$.status', 'delivered') WHERE id = ?").bind(order.id).run();
  return order.id as string;
}

const review = (body: Record<string, unknown>, ip = `10.8.0.${++n}`) =>
  get("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });

beforeEach(async () => {
  await reset();
  await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ stock: 50 }));
});

describe("reviews", () => {
  it("accepts one review per delivered item, held until approved", async () => {
    const id = await deliveredOrder();
    const body = { item_id: "GFT-TUM-001", order_id: id, phone: "9812345678", name: "Sita", stars: 5, body: "Lovely tumbler, keeps tea hot." };
    expect((await review(body)).status).toBe(201);
    expect((await review(body)).status).toBe(409);
    let pub = (await (await get("/api/reviews?item=GFT-TUM-001")).json()) as any;
    expect(pub.count).toBe(0);
    expect(await (await get("/product?item=GFT-TUM-001")).text()).not.toContain("window.GT_REVIEWS={\"count\":1");
    const { reviews } = (await (await admin("/api/admin/reviews")).json()) as any;
    expect(reviews[0]).toMatchObject({ status: "pending", stars: 5 });
    await admin(`/api/admin/reviews/${reviews[0].id}`, "POST", { status: "approved" });
    pub = (await (await get("/api/reviews?item=GFT-TUM-001")).json()) as any;
    expect(pub).toMatchObject({ count: 1, average: 5, reviews: [{ name: "Sita", body: "Lovely tumbler, keeps tea hot." }] });
    const html = await (await get("/product?item=GFT-TUM-001")).text();
    expect(html).toContain('"aggregateRating"');
    expect(html).toContain('window.GT_REVIEWS={"count":1');
  });

  it("refuses wrong phone, undelivered orders and items not in the order", async () => {
    const id = await deliveredOrder();
    const base = { item_id: "GFT-TUM-001", order_id: id, phone: "9812345678", name: "Sita", stars: 4, body: "Nice" };
    expect((await review({ ...base, phone: "9800000000" })).status).toBe(404);
    expect((await review({ ...base, item_id: "GFT-TUM-002" })).status).toBe(422);
    expect((await review({ ...base, stars: 6 })).status).toBe(422);
    await env.DB.prepare("UPDATE orders SET data = json_set(data, '$.status', 'in_transit') WHERE id = ?").bind(id).run();
    expect((await review(base)).status).toBe(409);
  });

  it("only lets the admin moderate", async () => {
    expect((await get("/api/admin/reviews")).status).toBe(401);
    expect((await get("/api/admin/reviews/1", { method: "DELETE" })).status).toBe(401);
  });

  it("shows the shop rating on the home page", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('window.GT_RATING={"count":0');
  });

  it("stores the happy customers number", async () => {
    const res = await admin("/api/admin/settings", "PUT", { happy_customers: 250 });
    expect(((await res.json()) as any).settings.happy_customers).toBe(250);
  });
});
