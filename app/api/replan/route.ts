import { z } from "zod";
import { env } from "@/lib/env";
import { json, readBody } from "@/lib/server/http";
import { replanCity } from "@/lib/server/picks";
import { PlaceOptionSchema } from "@/lib/schemas";
import type { PlaceOption } from "@/lib/types";

export const maxDuration = 180;

const Body = z.object({
  cityName: z.string().max(60),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(30),
  arriveDate: z.string(),
  hotel: PlaceOptionSchema.optional(),
  picks: z.array(PlaceOptionSchema).min(1).max(40),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  if (!env.geminiKey) return json({ error: "AI 키가 없어 동선을 짜지 못했습니다." }, 400);
  try {
    return json(await replanCity({ ...body, hotel: body.hotel as PlaceOption | undefined, picks: body.picks as PlaceOption[] }));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
