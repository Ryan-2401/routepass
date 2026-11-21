// 식당 추천: OpenStreetMap(Overpass)에서 "실제로 있는" 식당 목록을 먼저 가져오고,
// AI는 그 목록 안에서만 고릅니다. (AI가 식당 이름을 지어낼 수 없는 구조)
import "server-only";
import { z } from "zod";
import { cached, DAY } from "@/lib/cache";
import { env } from "@/lib/env";
import { generateJson } from "@/lib/server/gemini";
import { fetchRestaurants } from "@/lib/osm";
import type { Restaurant } from "@/lib/types";

export async function osmRestaurants(lat: number, lng: number): Promise<Restaurant[]> {
  return cached(`osm:${lat.toFixed(3)}:${lng.toFixed(3)}`, DAY, () =>
    fetchRestaurants(lat, lng, { "User-Agent": `RouteAI-student-project (${env.contactEmail})` }),
  );
}

const LOCAL_CUISINE: Record<string, string[]> = {
  RU: ["russian", "georgian", "uzbek"],
  BY: ["belarusian", "russian"],
  EE: ["estonian", "regional", "baltic"],
  FI: ["finnish", "nordic", "regional"],
  LV: ["latvian", "regional"],
  LT: ["lithuanian", "regional"],
};

function heuristicPick(list: Restaurant[], country: string, n: number): Restaurant[] {
  const pref = LOCAL_CUISINE[country] ?? ["regional", "local"];
  const score = (r: Restaurant) => (r.cuisine && pref.some((p) => r.cuisine!.includes(p)) ? 3 : 0) + (r.openingHours ? 1 : 0) + (r.website ? 1 : 0);
  return [...list]
    .sort((a, b) => score(b) - score(a))
    .slice(0, n)
    .map((r) => ({ ...r, reason: r.cuisine ? `음식 종류: ${r.cuisine}` : "지도 데이터 기준 시내 중심 근처" }));
}

const PickSchema = z.object({ picks: z.array(z.object({ index: z.number().int(), reason: z.string() })) });

export async function recommendRestaurants(params: {
  lat: number;
  lng: number;
  country: string;
  cityName: string;
  foodThemes: string[];
  count: number;
  pool?: Restaurant[]; // 브라우저가 미리 가져온 목록 (서버 IP가 지도 서버에 막힐 때 대비)
}): Promise<{ picks: Restaurant[]; poolSize: number; pickedBy: "ai" | "rule" }> {
  const pool = params.pool?.length ? params.pool : await osmRestaurants(params.lat, params.lng);
  if (!pool.length) return { picks: [], poolSize: 0, pickedBy: "rule" };
  if (!env.geminiKey) return { picks: heuristicPick(pool, params.country, params.count), poolSize: pool.length, pickedBy: "rule" };

  const list = pool.slice(0, 60).map((r, i) => `[${i}] ${r.name} | ${r.cuisine ?? "종류 모름"}${r.openingHours ? " | 영업시간 정보 있음" : ""}`).join("\n");
  const prompt = `${params.cityName}에서 여행자가 먹고 싶은 음식: ${params.foodThemes.join(", ") || "현지 음식"}.
아래는 지도 데이터에 실제로 등록된 식당 목록입니다. 이 목록 안에서만 ${params.count}곳을 고르세요. 목록에 없는 식당은 절대 만들지 마세요.
${list}
reason은 한국어 한 문장(음식 종류가 왜 맞는지). JSON: {"picks":[{"index":0,"reason":""}]}`;
  try {
    const { value } = await generateJson(prompt, PickSchema, {
      temperature: 0.3,
      extraCheck: (v) => v.picks.filter((p) => p.index < 0 || p.index >= Math.min(60, pool.length)).map((p) => `index ${p.index}는 목록에 없습니다.`),
    });
    const seen = new Set<number>();
    const picks = value.picks
      .filter((p) => !seen.has(p.index) && seen.add(p.index))
      .slice(0, params.count)
      .map((p) => ({ ...pool[p.index], reason: p.reason }));
    return { picks, poolSize: pool.length, pickedBy: "ai" };
  } catch {
    return { picks: heuristicPick(pool, params.country, params.count), poolSize: pool.length, pickedBy: "rule" };
  }
}
