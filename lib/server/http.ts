import "server-only";
import type { z } from "zod";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function readBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S> | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "요청 본문이 JSON이 아닙니다." }, 400);
  }
  const r = schema.safeParse(body);
  if (!r.success) return json({ error: "입력값이 올바르지 않습니다.", issues: r.error.issues.slice(0, 5) }, 400);
  return r.data;
}
