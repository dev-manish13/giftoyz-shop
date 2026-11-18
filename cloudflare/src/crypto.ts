const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

export function randomToken(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pepper(db: D1Database): Promise<ArrayBuffer> {
  await db.prepare("INSERT OR IGNORE INTO shipment_meta (key, value) VALUES ('pepper', randomblob(32))").run();
  const row = await db.prepare("SELECT value FROM shipment_meta WHERE key = 'pepper'").first<{ value: number[] | ArrayBuffer }>();
  if (!row) throw new Error("pepper missing");
  return row.value instanceof ArrayBuffer ? row.value : new Uint8Array(row.value).buffer;
}

export async function phoneDigest(db: D1Database, phone: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", await pepper(db), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(phone)));
}
