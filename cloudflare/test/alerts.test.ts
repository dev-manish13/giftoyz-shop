import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, get, product, reset } from "./helpers";

type Sent = { method: string; body: any };
let sent: Sent[] = [];
let updates: unknown[] = [];

const realFetch = globalThis.fetch;
const fakeTelegram = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const method = url.split("/").pop()!;
  sent.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
  const result = method === "getUpdates" ? updates : { message_id: 1 };
  return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
};

const order = () =>
  get("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.9.0.1" },
    body: JSON.stringify({
      items: [{ id: 1, color: "black", qty: 1 }],
      name: "Sita Sharma",
      phone: "9812345678",
      location_key: "tinkune",
      delivery: "home",
      address: "Baneshwor, near the temple",
      mode: "cod",
    }),
  });

beforeEach(async () => {
  await reset();
  sent = [];
  updates = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeTelegram as typeof fetch);
  await admin("/api/admin/products/GFT-TUM-001", "PUT", product({ stock: 5 }));
});
afterEach(() => vi.restoreAllMocks());

describe("order alerts", () => {
  it("stays silent until Telegram is connected", async () => {
    expect((await order()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toEqual([]);
    expect(await (await admin("/api/admin/alerts")).json()).toEqual({ token: true, connected: false, name: "" });
  });

  it("asks for /start when the bot has no messages yet", async () => {
    const res = await admin("/api/admin/alerts/connect", "POST", {});
    expect(res.status).toBe(409);
  });

  it("connects to the owner's chat and sends each new order there", async () => {
    updates = [{ message: { chat: { id: 4242, type: "private", first_name: "Manish" } } }];
    const res = await admin("/api/admin/alerts/connect", "POST", {});
    expect(await res.json()).toEqual({ connected: true, name: "Manish" });
    sent = [];
    expect((await order()).status).toBe(200);
    for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("sendMessage");
    expect(sent[0]!.body.chat_id).toBe("4242");
    expect(sent[0]!.body.text).toMatch(/^New order GT-\d{6}-\d{4}\n/);
    expect(sent[0]!.body.text).toContain("1 x Steel tumbler (black)");
    expect(sent[0]!.body.text).toContain("Sita Sharma · 9812345678");
    expect(sent[0]!.body.text).toContain("https://giftoyz.test/admin#orders");
  });

  it("keeps taking orders when Telegram is down", async () => {
    await env.DB.prepare("INSERT INTO app_kv (k, v) VALUES ('telegram_chat', ?)").bind(JSON.stringify({ id: "1", name: "x" })).run();
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => new Response("down", { status: 502 })) as typeof fetch);
    expect((await order()).status).toBe(200);
  });

  it("is admin only and can be turned off", async () => {
    expect((await get("/api/admin/alerts")).status).toBe(401);
    await env.DB.prepare("INSERT INTO app_kv (k, v) VALUES ('telegram_chat', ?)").bind(JSON.stringify({ id: "1", name: "x" })).run();
    await admin("/api/admin/alerts", "DELETE", {});
    expect(((await (await admin("/api/admin/alerts")).json()) as { connected: boolean }).connected).toBe(false);
  });
});
