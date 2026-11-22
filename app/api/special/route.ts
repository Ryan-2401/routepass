import { z } from "zod";
import { env } from "@/lib/env";
import { json, readBody } from "@/lib/server/http";
import { specialPicks } from "@/lib/server/picks";

export const maxDuration = 120;

const Body = z.object({ cityName: z.string().max(60), cityEn: z.string().max(100), kind: z.enum(["youtuber", "michelin"]) });

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  if (!env.geminiKey || !env.tavilyKey) return json({ error: "검색(TAVILY_API_KEY)과 AI 키가 있어야 스페셜 픽을 찾을 수 있습니다." }, 400);
  try {
    return json({ items: await specialPicks(body) });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
