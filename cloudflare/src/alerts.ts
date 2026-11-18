import { Hono } from "hono";
import { requireAdmin } from "./auth";
import { baseUrl, type App, type Env } from "./env";
import { HttpError } from "./http";

const API = "https://api.telegram.org";
const CHAT = "telegram_chat";

type Chat = { id: string; name: string };
type AlertOrder = {
  id: string; name: string; phone: string; total: number;
  location: { name: string; district?: string; type: string; fee: number };
  payment: { mode: string; wallet: string | null; paidNow: number; due: number };
  items: { name: string; qty: number; color: string; price: number }[];
};

const WALLETS: Record<string, string> = { esewa: "eSewa", khalti: "Khalti", bank: "bank QR" };
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

async function getChat(db: D1Database): Promise<Chat | null> {
  const row = await db.prepare("SELECT v FROM app_kv WHERE k = ?").bind(CHAT).first<{ v: string }>();
  return row ? (JSON.parse(row.v) as Chat) : null;
}

async function telegram<T>(env: Env, method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (res.status === 404 || res.status === 401) throw new HttpError(502, "Telegram doesn't recognise the bot token. Run npx wrangler secret put TELEGRAM_BOT_TOKEN again and paste only the token from BotFather.");
  if (!res.ok || !data.ok) throw new HttpError(502, `Telegram said: ${data.description ?? `error ${res.status}`}`);
  return data.result as T;
}

export function orderAlert(env: Env, o: AlertOrder): string {
  const pay =
    o.payment.mode === "full"
      ? `Paid in full: ${rs(o.payment.paidNow)} by ${WALLETS[o.payment.wallet ?? ""] ?? "wallet"} (check your statement)`
      : o.payment.paidNow > 0
        ? `COD: ${rs(o.payment.paidNow)} upfront by ${WALLETS[o.payment.wallet ?? ""] ?? "wallet"}, ${rs(o.payment.due)} cash to collect`
        : `COD: ${rs(o.payment.due)} cash to collect`;
  return [
    `New order ${o.id}`,
    `${rs(o.total)} · ${o.items.reduce((n, i) => n + i.qty, 0)} item(s)`,
    ...o.items.map((i) => `- ${i.qty} x ${i.name} (${i.color}) ${rs(i.price * i.qty)}`),
    `${o.location.type === "home" ? "Home delivery" : "Branch pickup"}: ${o.location.name}${o.location.district ? `, ${o.location.district}` : ""} (${rs(o.location.fee)})`,
    `${o.name} · ${o.phone}`,
    pay,
    `${baseUrl(env)}/admin#orders`,
  ].join("\n");
}

export async function sendAlert(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const chat = await getChat(env.DB);
  if (!chat) return;
  try {
    await telegram(env, "sendMessage", { chat_id: chat.id, text, disable_web_page_preview: true });
  } catch (err) {
    console.error("Telegram alert failed:", err instanceof Error ? err.message : err);
  }
}

const needToken = (env: Env) => {
  if (!env.TELEGRAM_BOT_TOKEN) throw new HttpError(409, "The bot token isn't set yet. Run: npx wrangler secret put TELEGRAM_BOT_TOKEN");
};

export const alertRoutes = new Hono<App>()
  .get("/api/admin/alerts", requireAdmin, async (c) => {
    const chat = await getChat(c.env.DB);
    return c.json({ token: !!c.env.TELEGRAM_BOT_TOKEN, connected: !!chat, name: chat?.name ?? "" });
  })
  .post("/api/admin/alerts/connect", requireAdmin, async (c) => {
    needToken(c.env);
    type Update = { message?: { chat?: { id: number; type: string; first_name?: string; username?: string } } };
    const updates = await telegram<Update[]>(c.env, "getUpdates", { limit: 50, allowed_updates: ["message"] });
    const chat = [...updates].reverse().map((u) => u.message?.chat).find((ch) => ch?.type === "private");
    if (!chat) throw new HttpError(409, "Open your bot in Telegram, send it /start, then press Connect again.");
    const saved: Chat = { id: String(chat.id), name: chat.first_name || chat.username || "you" };
    await c.env.DB.prepare("INSERT INTO app_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(CHAT, JSON.stringify(saved)).run();
    await telegram(c.env, "sendMessage", { chat_id: saved.id, text: "GifToyz order alerts are on. New orders from giftoyz.com will show up here." });
    return c.json({ connected: true, name: saved.name });
  })
  .post("/api/admin/alerts/test", requireAdmin, async (c) => {
    needToken(c.env);
    const chat = await getChat(c.env.DB);
    if (!chat) throw new HttpError(409, "Connect Telegram first.");
    await telegram(c.env, "sendMessage", { chat_id: chat.id, text: "Test alert from giftoyz.com. Order alerts are working." });
    return c.json({ sent: true });
  })
  .delete("/api/admin/alerts", requireAdmin, async (c) => {
    await c.env.DB.prepare("DELETE FROM app_kv WHERE k = ?").bind(CHAT).run();
    return c.json({ connected: false });
  });
