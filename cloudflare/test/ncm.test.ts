import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollShipments, ncmToStatus, ship } from "../src/shipping";
import { startSync, stepSync } from "../src/ratesync";
import { NcmClient } from "../src/ncm";
import { admin, get, product, reset } from "./helpers";

type Call = { method: string; path: string; params: URLSearchParams; body: any };
let calls: Call[];
let statuses: { status: string; added_time: string }[];
let createMode: "ok" | "timeout" | "reject";

function fakeNcm(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.host !== "demo.nepalcanmove.com") return Promise.reject(new Error(`unexpected host ${url.host}`));
  const call = { method: init?.method ?? "GET", path: url.pathname, params: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null };
  calls.push(call);
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
  switch (call.path) {
    case "/api/v1/order/create":
      if (createMode === "timeout") return Promise.reject(new DOMException("timed out", "TimeoutError"));
      if (createMode === "reject") return json({ branch: ["Invalid branch"] }, 400);
      return json({ orderid: 27940001 });
    case "/api/v1/order/status":
      return json(statuses);
    case "/api/v1/order":
      return json({ destination_branch_name: "NARAYANGHAT", destination_branch_phone: "056-123456", trackid: "TRK1" });
    case "/api/v1/shipping-rate":
      if (call.params.get("destination") === "AMARDAHA") return json({ detail: "No route" }, 400);
      return json({ charge: call.params.get("type") === "D2B" ? "111.00" : "222.00" });
    default:
      return json({}, 404);
  }
}

const creates = () => calls.filter((c) => c.path === "/api/v1/order/create");

async function confirmedOrder(location = "chitwan") {
  const res = await get("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.4.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ items: [{ id: 1, color: "black", qty: 2 }], name: "Binita Rai", phone: "9812345678", location_key: location, delivery: "home", address: "Bharatpur 10", mode: "cod" }),
  });
  const { order } = (await res.json()) as { order: any };
  await admin(`/api/admin/orders/${order.id}/status`, "POST", { status: "confirmed" });
  return order.id as string;
}

beforeEach(async () => {
  await reset();
  calls = [];
  statuses = [{ status: "Pickup Order Created", added_time: "2026-11-10 09:00:00" }];
  createMode = "ok";
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeNcm as typeof fetch);
  await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ stock: 10, weight_kg: 0.4 }));
});
afterEach(() => vi.restoreAllMocks());

describe("status words", () => {
  it.each([
    ["Delivered", "delivered"],
    ["Order delivered to customer", "delivered"],
    ["Undelivered", null],
    ["Not delivered, customer absent", null],
    ["Sent for Delivery", "in_transit"],
    ["Pickup Complete", "in_transit"],
    ["Arrived at NARAYANGHAT", "in_transit"],
    ["Pickup Order Created", null],
    ["Returned to vendor", null],
    ["Delivery cancelled", null],
  ])("%s -> %s", (text, want) => expect(ncmToStatus(text)).toBe(want));
});

describe("shipping", () => {
  it("sends a confirmed order to NCM once, with the mapped branch and receiver name", async () => {
    const id = await confirmedOrder();
    let res = await admin(`/api/admin/orders/${id}/ship`, "POST");
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out).toMatchObject({ ncm_id: "27940001", created: true, order: { status: "with_ncm", ncm: { id: "27940001" } } });
    const sent = creates()[0]!.body;
    expect(sent).toMatchObject({ branch: "NARAYANGHAT", fbranch: "NEWROAD", delivery_type: "Door2Door", vref_id: id, weight: "0.8", phone: "9812345678" });
    expect(sent.instruction).toMatch(/^Receiver: Binita Rai/);
    expect(Number(sent.cod_charge)).toBe(out.order.payment.due);
    res = await admin(`/api/admin/orders/${id}/ship`, "POST");
    expect(await res.json()).toMatchObject({ created: false, ncm_id: "27940001" });
    expect(creates()).toHaveLength(1);
  });

  it("refuses unconfirmed orders", async () => {
    const res = await get("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.5.0.1" },
      body: JSON.stringify({ items: [{ id: 1, color: "black", qty: 1 }], name: "Ram", phone: "9812345678", location_key: "tinkune", delivery: "home", address: "Tinkune 32", mode: "cod" }),
    });
    const { order } = (await res.json()) as { order: any };
    expect((await admin(`/api/admin/orders/${order.id}/ship`, "POST")).status).toBe(409);
  });

  it("locks a shipment whose create timed out until it is resolved", async () => {
    const id = await confirmedOrder();
    createMode = "timeout";
    expect((await admin(`/api/admin/orders/${id}/ship`, "POST")).status).toBe(504);
    createMode = "ok";
    const again = await admin(`/api/admin/orders/${id}/ship`, "POST");
    expect(again.status).toBe(409);
    expect(creates()).toHaveLength(1);
    await admin(`/api/admin/shipments/${id}/resolve`, "POST", { ncm_id: "27949999" });
    expect(await (await admin(`/api/admin/orders/${id}/ship`, "POST")).json()).toMatchObject({ ncm_id: "27949999", created: false });
  });

  it("frees the shipment when NCM rejects it", async () => {
    const id = await confirmedOrder();
    createMode = "reject";
    const res = await admin(`/api/admin/orders/${id}/ship`, "POST");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ detail: "branch: Invalid branch" });
    createMode = "ok";
    expect((await admin(`/api/admin/orders/${id}/ship`, "POST")).status).toBe(200);
  });

  it("can be switched off for the test site", async () => {
    const id = await confirmedOrder();
    const body = { ref: id, name: "Binita Rai", phone: "9812345678", address: "Bharatpur", branch: "CHITWAN", delivery: "home" as const, cod_charge: 0, phone2: "", package: "", instruction: "", weight: 1, dimensions: null };
    await expect(ship({ ...env, NCM_ALLOW_CREATE: "false" }, body)).rejects.toMatchObject({ status: 503 });
    expect(creates()).toHaveLength(0);
  });
});

describe("tracking", () => {
  it("shows the live timeline to the customer and moves the order on", async () => {
    const id = await confirmedOrder();
    await admin(`/api/admin/orders/${id}/ship`, "POST");
    statuses = [
      { status: "Pickup Order Created", added_time: "2026-11-10 09:00:00" },
      { status: "Arrived at NARAYANGHAT", added_time: "2026-11-11 10:00:00" },
      { status: "Pickup Complete", added_time: "2026-11-10 15:00:00" },
    ];
    const res = await get(`/api/track?q=${id}&phone=9812345678`, { headers: { "CF-Connecting-IP": "10.6.0.1" } });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out.statuses.map((s: any) => s.status)).toEqual(["Arrived at NARAYANGHAT", "Pickup Complete", "Pickup Order Created"]);
    expect(out).toMatchObject({ awb: "27940001", live: true, order: { status: "in_transit" } });
    const byAwb = await get(`/api/track?q=27940001&phone=9812345678`, { headers: { "CF-Connecting-IP": "10.6.0.2" } });
    expect(byAwb.status).toBe(200);
    expect((await get(`/api/track?q=${id}&phone=9800000000`, { headers: { "CF-Connecting-IP": "10.6.0.3" } })).status).toBe(404);
  });

  it("finds an order before it ships", async () => {
    const id = await confirmedOrder();
    const out = (await (await get(`/api/track?q=${id}&phone=9812345678`, { headers: { "CF-Connecting-IP": "10.6.0.4" } })).json()) as any;
    expect(out).toMatchObject({ ref: id, awb: null, statuses: [], order: { status: "confirmed" } });
  });
});

describe("background checks", () => {
  it("polls active shipments, saves branch details and marks delivered", async () => {
    const id = await confirmedOrder();
    await admin(`/api/admin/orders/${id}/ship`, "POST");
    statuses = [{ status: "Delivered", added_time: "2026-11-12 12:00:00" }];
    expect(await pollShipments(env)).toBe(1);
    const { orders } = (await (await admin("/api/admin/orders")).json()) as { orders: any[] };
    expect(orders[0].status).toBe("delivered");
    expect(orders[0].history.map((h: any) => h.status)).toEqual(["payment_pending", "confirmed", "with_ncm", "in_transit", "delivered"]);
    expect(orders[0].ncm).toMatchObject({ branch: "NARAYANGHAT", branch_phone: "056-123456", trackid: "TRK1", status: "Delivered" });
    calls = [];
    expect(await pollShipments(env)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("refreshes prices in batches and reports changes and failures", async () => {
    const all = await env.DB.prepare("SELECT key FROM rates ORDER BY key LIMIT 30").all<{ key: string }>();
    await startSync(env.DB, "NEWROAD");
    await env.DB.prepare("UPDATE jobs SET data = json_set(data, '$.keys', json(?)) WHERE name = 'rates'").bind(JSON.stringify(all.results.map((r) => r.key))).run();
    const client = new NcmClient({ token: "t", baseUrl: "https://demo.nepalcanmove.com", sleep: async () => {} });
    let steps = 0;
    while (await stepSync(env.DB, client)) steps++;
    expect(steps).toBe(3);
    const last = (await (await admin("/api/admin/rates")).json()) as any;
    expect(last.running).toBe(false);
    expect(last.last_sync).toMatchObject({ origin: "NEWROAD", checked: 30, updated: 29, failed: ["AMARDAHA"], failed_count: 1 });
    const row = await env.DB.prepare("SELECT home, branch, source FROM rates WHERE key = ?").bind(all.results[1]!.key).first();
    expect(row).toEqual({ home: 222, branch: 111, source: "ncm" });
    await env.DB.prepare("UPDATE rates SET home = 150, branch = 100, source = 'card' WHERE source = 'ncm'").run();
    expect(calls.filter((c) => c.path === "/api/v1/shipping-rate").every((c) => c.params.get("creation") === "NEWROAD")).toBe(true);
  });
});

describe("webhook", () => {
  const hook = (body: unknown, token = "test-webhook-secret-0000000000") =>
    get(`/api/ncm/webhook?token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("checks the token, ignores repeats and applies real statuses", async () => {
    const id = await confirmedOrder();
    await admin(`/api/admin/orders/${id}/ship`, "POST");
    expect((await hook({ order_id: 27940001 }, "wrong")).status).toBe(401);
    expect((await hook({ nothing: 1 })).status).toBe(422);
    statuses = [{ status: "Sent for Delivery", added_time: "2026-11-11 08:00:00" }];
    expect(await (await hook({ order_id: 27940001, status: "x" })).json()).toEqual({ status: "ok" });
    expect(await (await hook({ order_id: 27940001, status: "x" })).json()).toEqual({ status: "duplicate" });
    expect(await (await hook({ order_id: 12345678 })).json()).toEqual({ status: "ignored" });
    const { orders } = (await (await admin("/api/admin/orders")).json()) as { orders: any[] };
    expect(orders[0].status).toBe("in_transit");
  });
});
