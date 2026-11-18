import { Hono } from "hono";
import { requireAdmin } from "./auth";
import type { App, Env } from "./env";
import { clean, HttpError } from "./http";

export const MEDIA_FILE = /^([a-z0-9-]+-(600|800|1200|1600|2400)\.(avif|webp|jpg)|q-[a-f0-9]{12}\.png)$/;
const MAX_UPLOAD = 25 * 1024 * 1024;
const PHOTO_WIDTHS = [600, 1200] as const;
const BANNER_WIDTHS = [800, 1600, 2400] as const;
const INPUTS = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
const OUTPUTS = [
  ["avif", "image/avif", 55],
  ["webp", "image/webp", 80],
  ["jpg", "image/jpeg", 84],
] as const;
const TYPES: Record<string, string> = { avif: "image/avif", webp: "image/webp", jpg: "image/jpeg", png: "image/png" };
const IMMUTABLE = "public, max-age=31536000, immutable";

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

const stream = (bytes: ArrayBuffer) => new Blob([bytes]).stream();

async function readImage(env: Env, bytes: ArrayBuffer, minSide: number): Promise<{ width: number; height: number }> {
  let info: ImageInfoResponse;
  try {
    info = await env.IMAGES.info(stream(bytes));
  } catch {
    throw new HttpError(422, "That file isn't a photo we can read");
  }
  if (!("width" in info) || !INPUTS.has(info.format)) throw new HttpError(422, "Use a JPEG, PNG, WebP or iPhone HEIC photo");
  if (info.width * info.height > 80_000_000) throw new HttpError(422, "That photo is too large to process");
  if (Math.min(info.width, info.height) < minSide) {
    throw new HttpError(422, `That photo is too small. Use one at least ${minSide} pixels wide.`);
  }
  return { width: info.width, height: info.height };
}

async function render(env: Env, bytes: ArrayBuffer, width: number, format: ImageOutputOptions["format"], quality?: number) {
  const out = await env.IMAGES.input(stream(bytes))
    .transform({ width, fit: "scale-down" })
    .output({ format, quality });
  return new Response(out.image()).arrayBuffer();
}

async function writeVariants(env: Env, bytes: ArrayBuffer, stem: string, widths: readonly number[]) {
  const { width, height } = await readImage(env, bytes, 300);
  const puts: Promise<unknown>[] = [];
  for (const target of widths) {
    for (const [ext, type, quality] of OUTPUTS) {
      puts.push(
        render(env, bytes, target, type, quality).then((data) =>
          env.MEDIA.put(`products/${stem}-${target}.${ext}`, data, {
            httpMetadata: { contentType: type, cacheControl: IMMUTABLE },
          }),
        ),
      );
    }
  }
  await Promise.all(puts);
  const w = Math.min(widths[widths.length - 1]!, width);
  return { w, h: Math.round((height * w) / width) };
}

async function readUpload(req: Request): Promise<ArrayBuffer> {
  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > MAX_UPLOAD) throw new HttpError(413, "Photos must be under 25 MB");
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(422, "No photo received");
  if (bytes.byteLength > MAX_UPLOAD) throw new HttpError(413, "Photos must be under 25 MB");
  return bytes;
}

export const mediaRoutes = new Hono<App>()
  .get("/media/products/:name", async (c) => {
    const name = c.req.param("name");
    if (!MEDIA_FILE.test(name)) return c.notFound();
    const cache = caches.default;
    const key = new Request(new URL(`/media/products/${name}`, c.req.url).toString());
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, hit);
    const obj = await c.env.MEDIA.get(`products/${name}`);
    if (!obj) return c.notFound();
    const ext = name.slice(name.lastIndexOf(".") + 1);
    const res = new Response(obj.body, {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": IMMUTABLE, ETag: obj.httpEtag },
    });
    c.executionCtx.waitUntil(cache.put(key, res.clone()));
    return res;
  })
  .post("/api/admin/media", requireAdmin, async (c) => {
    const kind = c.req.query("kind") ?? "photo";
    if (kind !== "photo" && kind !== "qr" && kind !== "banner") throw new HttpError(422, "kind must be photo, qr or banner");
    const alt = clean(c.req.query("alt") ?? "").slice(0, 160);
    const bytes = await readUpload(c.req.raw);
    if (kind === "qr") {
      await readImage(c.env, bytes, 150);
      const name = `q-${hex(6)}.png`;
      await c.env.MEDIA.put(`products/${name}`, await render(c.env, bytes, 1000, "image/png"), {
        httpMetadata: { contentType: "image/png", cacheControl: IMMUTABLE },
      });
      return c.json({ src: `/media/products/${name}` });
    }
    if (kind === "banner") {
      const stem = `b-${hex(6)}`;
      const { w, h } = await writeVariants(c.env, bytes, stem, BANNER_WIDTHS);
      return c.json({ image: { src: `/media/products/${stem}`, w, h, widths: [...BANNER_WIDTHS] } });
    }
    const stem = `u-${hex(6)}`;
    const { w, h } = await writeVariants(c.env, bytes, stem, PHOTO_WIDTHS);
    return c.json({
      image: {
        src: `/media/products/${stem}`,
        w,
        h,
        kind: "hero",
        alt: alt || "Product photo",
        formats: ["avif", "webp", "jpg"],
        widths: [...PHOTO_WIDTHS],
        focal: { x: 50, y: h > w * 1.25 ? 45 : 50 },
        fit: "cover",
        color: "",
      },
    });
  });
