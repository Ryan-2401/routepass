import { z } from "zod";
import { env } from "@/lib/env";
import { json, readBody } from "@/lib/server/http";
import { curateRestaurants } from "@/lib/server/picks";

export const maxDuration = 120;

const Body = z.object({
  cityName: z.string().max(60),
  mealBudgetKRW: z.number().int().min(0),
  themes: z.array(z.string().max(80)).max(20),
  pool: z
    .array(
      z.object({
        osmId: z.string(),
        name: z.string(),
        cuisine: z.string().optional(),
        lat: z.number(),
        lng: z.number(),
        openingHours: z.string().optional(),
        website: z.string().optional(),
        osmUrl: z.string(),
      }),
    )
    .max(80),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  if (!env.geminiKey) return json({ error: "AI 키가 없어 식당을 분류하지 못했습니다." }, 400);
  try {
    return json({ options: await curateRestaurants(body) });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
