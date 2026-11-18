import { now } from "./env";

export const PRODUCTION_URL = "https://portal.nepalcanmove.com";
export const DEMO_URL = "https://demo.nepalcanmove.com";
const RETRYABLE = new Set([429, 502, 503, 504]);

export class NcmError extends Error {
  constructor(message: string, readonly status = 502, readonly code = "NCM_REJECTED") {
    super(message);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function safeMessage(data: any): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of ["message", "detail", "error", "Error"]) {
      const v = data[key];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
    }
    for (const [key, v] of Object.entries(data)) {
      if (Array.isArray(v) && typeof v[0] === "string") return `${key}: ${v[0]}`.slice(0, 200);
      if (typeof v === "string" && v.trim()) return `${key}: ${v}`.slice(0, 200);
    }
  }
  if (Array.isArray(data) && typeof data[0] === "string") return data[0].slice(0, 200);
  return "NCM rejected the request";
}

export interface NcmOptions {
  token: string;
  baseUrl: string;
  db?: D1Database;
  timeoutMs?: number;
  retries?: number;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class NcmClient {
  private readonly base: string;
  private readonly retries: number;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: NcmOptions) {
    if (opts.baseUrl !== PRODUCTION_URL && opts.baseUrl !== DEMO_URL) throw new Error("NCM_BASE_URL must be the NCM portal or demo host");
    this.base = opts.baseUrl;
    this.retries = Math.max(1, opts.retries ?? 3);
    this.fetcher = opts.fetcher ?? fetch.bind(globalThis);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async record(ref: string, op: string, err: NcmError, httpStatus: number, detail: string) {
    console.warn(`NCM ${op} ${ref} failed: ${err.code} ${detail}`);
    try {
      await this.opts.db
        ?.prepare("INSERT INTO ncm_events (ts, ref, op, code, http_status, message) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(now(), ref.slice(0, 40), op.slice(0, 40), err.code.slice(0, 40), httpStatus, detail.slice(0, 300))
        .run();
    } catch (e) {
      console.error("Could not record NCM event", e);
    }
  }

  private async request(method: string, path: string, o: { ref: string; op: string; params?: Record<string, string>; body?: unknown; safe: boolean }): Promise<any> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(o.params ?? {})) url.searchParams.set(k, v);
    let last: NcmError | null = null;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      if (attempt) await this.sleep(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.random() * 250);
      let res: Response;
      try {
        res = await this.fetcher(url.toString(), {
          method,
          headers: { Authorization: `Token ${this.opts.token}`, Accept: "application/json", ...(o.body ? { "Content-Type": "application/json" } : {}) },
          body: o.body ? JSON.stringify(o.body) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 25_000),
        });
      } catch (e) {
        last = new NcmError("NCM did not answer in time", 504, "NCM_TIMEOUT");
        await this.record(o.ref, o.op, last, 0, e instanceof Error ? e.name : "error");
        if (o.safe) continue;
        throw last;
      }
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.status < 400) return data;
      if (res.status === 401 || res.status === 403) last = new NcmError("NCM refused the API token", 502, "NCM_AUTH");
      else if (RETRYABLE.has(res.status)) last = new NcmError("NCM is busy, try again shortly", 503, "NCM_BUSY");
      else if (res.status >= 500) last = new NcmError("NCM had an internal error", 502, "NCM_SERVER");
      else last = new NcmError(safeMessage(data), 422, "NCM_REJECTED");
      await this.record(o.ref, o.op, last, res.status, last.message);
      const repeat = res.status === 429 || (o.safe && RETRYABLE.has(res.status));
      if (!repeat) throw last;
    }
    throw last ?? new NcmError("NCM request failed");
  }

  async createOrder(payload: Record<string, string>): Promise<string> {
    const ref = payload.vref_id ?? "";
    const data = await this.request("POST", "/api/v1/order/create", { ref, op: "create", body: payload, safe: false });
    const id = data && typeof data === "object" ? data.orderid : null;
    if (id === null || id === undefined || id === "") {
      const err = new NcmError(safeMessage(data), 502, "NCM_BAD_RESPONSE");
      await this.record(ref, "create", err, 200, err.message);
      throw err;
    }
    return String(id);
  }

  async orderDetails(id: string): Promise<Record<string, any>> {
    const data = await this.request("GET", "/api/v1/order", { ref: id, op: "details", params: { id }, safe: true });
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  }

  async orderStatuses(id: string): Promise<Record<string, any>[]> {
    const data = await this.request("GET", "/api/v1/order/status", { ref: id, op: "status", params: { id }, safe: true });
    return Array.isArray(data) ? data.filter((x) => x && typeof x === "object") : [];
  }

  async orderComments(id: string): Promise<Record<string, any>[]> {
    const data = await this.request("GET", "/api/v1/order/comment", { ref: id, op: "comments", params: { id }, safe: true });
    return Array.isArray(data) ? data.filter((x) => x && typeof x === "object") : [];
  }

  async shippingRate(origin: string, destination: string, type: string): Promise<number> {
    const data = await this.request("GET", "/api/v1/shipping-rate", { ref: destination, op: "rate", params: { creation: origin, destination, type }, safe: true });
    const charge = Number.parseFloat(data?.charge);
    if (!Number.isFinite(charge)) throw new NcmError("NCM returned no price", 502, "NCM_BAD_RESPONSE");
    return Math.round(charge);
  }

  async setWebhook(url: string): Promise<void> {
    await this.request("POST", "/api/v2/vendor/webhook", { ref: "webhook", op: "webhook", body: { webhook_url: url }, safe: true });
  }
}
