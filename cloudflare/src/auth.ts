import { createMiddleware } from "hono/factory";
import type { App } from "./env";
import { HttpError } from "./http";
import { allow, clientIp } from "./ratelimit";
import { tokensMatch } from "./security";

export const requireAdmin = createMiddleware<App>(async (c, next) => {
  const key = c.env.ADMIN_API_KEY;
  if (!key || key.length < 32) throw new HttpError(503, "Admin access is not configured");
  const header = c.req.header("authorization") ?? "";
  const space = header.indexOf(" ");
  const scheme = space < 0 ? header : header.slice(0, space);
  const provided = space < 0 ? "" : header.slice(space + 1);
  if (scheme.toLowerCase() === "bearer" && provided && tokensMatch(key, provided)) {
    await next();
    return;
  }
  if (!(await allow(c.env.DB, `auth:${clientIp(c.req.raw.headers)}`, 5, 60))) {
    throw new HttpError(429, "Too many attempts. Wait a minute.");
  }
  throw new HttpError(401, "Wrong admin key", { "WWW-Authenticate": "Bearer" });
});
