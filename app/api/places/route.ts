import { z } from "zod";
import { json, readBody } from "@/lib/server/http";
import { recommendRestaurants } from "@/lib/server/places";

export const maxDuration = 300;

const Body = z.object({
  lat: z.number(),
  lng: z.number(),
  country: z.string(),
  cityName: z.string(),
  foodThemes: z.array(z.string()).max(12),
  count: z.number().int().min(1).max(6).default(3),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  try {
    return json(await recommendRestaurants(body));
  } catch (e) {
    return json({ error: `지도 데이터(OpenStreetMap)에서 식당을 불러오지 못했습니다: ${(e as Error).message}` }, 502);
  }
}
