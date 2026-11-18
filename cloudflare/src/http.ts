import type { Context } from "hono";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    readonly headers: Record<string, string> = {},
  ) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
  }
}

const UNPRINTABLE = /(?! )[\p{C}\p{Z}]/gu;

export function clean(value: string): string {
  return value.replace(UNPRINTABLE, "").split(" ").filter(Boolean).join(" ");
}

export function validate<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      422,
      result.error.issues.map((i) => ({ loc: ["body", ...i.path.map(String)], msg: i.message })),
    );
  }
  return result.data;
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send JSON");
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(422, [{ loc: ["body"], msg: "Body must be JSON" }]);
  }
  return validate(schema, raw);
}

export function isConstraintError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT/.test(err.message);
}
