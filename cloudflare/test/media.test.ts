import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ADMIN, get } from "./helpers";

const upload = (kind: string, body: BodyInit, key = ADMIN) =>
  get(`/api/admin/media?kind=${kind}&alt=Blue%20tumbler`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "CF-Connecting-IP": "10.1.1.1" },
    body,
  });

describe("media", () => {
  it("serves stored files with long cache and refuses other names", async () => {
    await env.MEDIA.put("products/u-abcdefabcdef-600.jpg", new Uint8Array([1, 2, 3]));
    const res = await get("/media/products/u-abcdefabcdef-600.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    for (const bad of ["/media/products/x.svg", "/media/products/..%2fsecret", "/media/products/u-abc-601.jpg", "/media/products/missing-600.jpg"]) {
      expect((await get(bad)).status).toBe(404);
    }
  });

  it("needs the admin key", async () => {
    expect((await upload("photo", "x", "wrong")).status).toBe(401);
  });

  it("rejects empty, unreadable and unknown kinds", async () => {
    expect((await upload("photo", "")).status).toBe(422);
    expect((await upload("photo", "not an image at all")).status).toBe(422);
    expect((await upload("video", "x")).status).toBe(422);
  });

  it("rejects declared oversize uploads", async () => {
    const res = await get("/api/admin/media?kind=photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}`, "content-length": String(30 * 1024 * 1024) },
    });
    expect(res.status).toBe(413);
  });

  it("stores every size and format of a photo", async () => {
    const photo = await (await get("/about-cover-1024.jpg")).arrayBuffer();
    const res = await upload("photo", photo);
    expect(res.status).toBe(200);
    const { image } = (await res.json()) as { image: { src: string; w: number; h: number; alt: string } };
    expect(image.src).toMatch(/^\/media\/products\/u-[a-f0-9]{12}$/);
    expect(image.alt).toBe("Blue tumbler");
    expect(image.w).toBeGreaterThan(0);
    const stem = image.src.split("/").pop();
    const { objects } = await env.MEDIA.list({ prefix: `products/${stem}` });
    expect(objects.map((o) => o.key.split("-").pop()).sort()).toEqual(
      ["1200.avif", "1200.jpg", "1200.webp", "600.avif", "600.jpg", "600.webp"],
    );
  });

  it("stores a QR as one PNG", async () => {
    const photo = await (await get("/about-cover-1024.jpg")).arrayBuffer();
    const res = await upload("qr", photo);
    expect(res.status).toBe(200);
    const { src } = (await res.json()) as { src: string };
    expect(src).toMatch(/^\/media\/products\/q-[a-f0-9]{12}\.png$/);
    expect((await get(src)).headers.get("Content-Type")).toBe("image/png");
  });
});
