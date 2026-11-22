// 장소 고르기용 AI 기능
// 1) curateRestaurants: 지도에 실제로 있는 식당 목록을 카테고리로 나누고 추천 이유를 붙임 (목록 밖 식당은 못 만듦)
// 2) specialPicks: 웹 검색 결과에서 유튜버 추천·미슐랭 식당을 뽑음 (검색 결과 번호로만 출처를 대게 해서 지어낼 수 없음)
// 3) replanCity: 사용자가 고른 장소만으로 날짜별 동선을 짜고, 영업시간은 코드가 다시 검사
import "server-only";
import OpeningHours from "opening_hours";
import { z } from "zod";
import { distanceKm } from "@/lib/geo";
import { generateJson } from "@/lib/server/gemini";
import { webSearch } from "@/lib/server/verify";
import type { DayRoute, PlaceOption, Restaurant } from "@/lib/types";

export const FOOD_CATEGORIES = ["현지 전통", "가성비", "카페·디저트", "분위기 좋은 저녁", "파인다이닝"] as const;

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/* ---------- 1. 식당 분류 ---------- */
const CurateSchema = z.object({
  picks: z.array(
    z.object({
      index: z.number().int(),
      category: z.enum(FOOD_CATEGORIES),
      priceNote: z.string().max(60),
      reason: z.string().max(160),
    }),
  ),
});

export async function curateRestaurants(p: { cityName: string; pool: Restaurant[]; mealBudgetKRW: number; themes: string[] }): Promise<PlaceOption[]> {
  const pool = p.pool.slice(0, 60);
  const list = pool.map((r, i) => `[${i}] ${r.name} | ${r.cuisine ?? "종류 모름"}${r.openingHours ? " | 영업시간 정보 있음" : ""}`).join("\n");
  const prompt = `${p.cityName}의 식당 목록입니다(지도 데이터에 실제로 등록된 곳). 여행자의 1인 1끼 식비 상한은 ${won(p.mealBudgetKRW)}이고, 일정의 식사 주제는 ${
    p.themes.join(", ") || "현지 음식"
  }입니다.
이 목록 안에서만 최대 12곳을 고르고 각각 카테고리를 붙이세요: ${FOOD_CATEGORIES.join(", ")}.
식비 상한이 낮으면 파인다이닝은 빼고, 15만 원 이상이면 파인다이닝을 우선하세요.
priceNote는 이름과 음식 종류로 짐작한 1인 가격대(예: "1인 2~3만 원 추정")이고, reason은 한국어 한 문장입니다. 목록에 없는 식당은 절대 만들지 마세요.
${list}
JSON: {"picks":[{"index":0,"category":"현지 전통","priceNote":"","reason":""}]}`;
  const { value } = await generateJson(prompt, CurateSchema, {
    temperature: 0.3,
    extraCheck: (v) => v.picks.filter((x) => x.index < 0 || x.index >= pool.length).map((x) => `index ${x.index}는 목록에 없습니다.`),
  });
  const seen = new Set<number>();
  return value.picks
    .filter((x) => !seen.has(x.index) && seen.add(x.index))
    .slice(0, 12)
    .map((x) => {
      const r = pool[x.index];
      return {
        id: `rest-${r.osmId}`,
        kind: "restaurant",
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        category: x.category,
        priceNote: x.priceNote,
        openingHours: r.openingHours,
        link: r.website,
        mapUrl: r.osmUrl,
        source: "osm",
        reason: x.reason,
      } satisfies PlaceOption;
    });
}

/* ---------- 2. 스페셜 픽 (유튜버 추천 / 미슐랭) ---------- */
export interface SpecialCandidate {
  name: string;
  searchName: string; // 지도에서 찾을 이름 (현지 표기)
  by: string; // 추천한 사람·채널, 또는 "미슐랭 1스타"
  hoursText?: string;
  source: { title: string; url: string };
}

const SpecialSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().max(80),
      searchName: z.string().max(120),
      by: z.string().max(60),
      hoursText: z.string().max(120).optional(),
      sourceIndex: z.number().int(),
    }),
  ),
});

export async function specialPicks(p: { cityName: string; cityEn: string; kind: "youtuber" | "michelin" }): Promise<SpecialCandidate[]> {
  const queries =
    p.kind === "youtuber"
      ? [`${p.cityName} 맛집 유튜버 추천`, `${p.cityName} 맛집 먹방 유튜브 다녀온 곳`]
      : [`Michelin Guide ${p.cityEn} starred restaurants`, `${p.cityEn} Michelin star restaurant list 2026`];
  const hits = (await Promise.all(queries.map((q) => webSearch(q).catch(() => [])))).flat();
  const uniq = hits.filter((h, i) => hits.findIndex((x) => x.url === h.url) === i).slice(0, 10);
  if (!uniq.length) return [];
  const list = uniq.map((h, i) => `[${i}] ${h.title}\nURL: ${h.url}\n내용: ${h.content.slice(0, 700)}`).join("\n\n");
  const what =
    p.kind === "youtuber"
      ? "유튜버(또는 유튜브 채널)가 직접 방문하거나 추천한 식당"
      : "미슐랭 가이드에 오른 식당(별 개수나 빕 구르망 여부를 by에 적기, 예: \"미슐랭 1스타\")";
  const prompt = `아래 검색 결과에서 ${p.cityName}(${p.cityEn})에 있는 ${what}만 뽑으세요. 최대 8곳.
규칙: 검색 결과 본문에 이름과 추천 사실이 실제로 적힌 곳만. sourceIndex는 근거가 된 검색 결과 번호. 다른 도시 식당, 추측, 기억은 금지.
name은 한국어 표기(없으면 원어), searchName은 지도에서 찾을 현지 원어 이름, by는 추천한 유튜버·채널 이름(모르면 "유튜버 추천"), hoursText는 본문에 영업시간이 있을 때만.
[검색 결과]
${list}
JSON: {"items":[{"name":"","searchName":"","by":"","hoursText":"","sourceIndex":0}]}`;
  const { value } = await generateJson(prompt, SpecialSchema, { temperature: 0.1 });
  return value.items
    .filter((x) => x.sourceIndex >= 0 && x.sourceIndex < uniq.length)
    .map((x) => ({
      name: x.name,
      searchName: x.searchName || x.name,
      by: x.by,
      hoursText: x.hoursText || undefined,
      source: { title: uniq[x.sourceIndex].title, url: uniq[x.sourceIndex].url },
    }));
}

/* ---------- 3. 고른 곳으로 동선 다시 짜기 ---------- */
const ReplanSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      stops: z.array(z.object({ id: z.string(), time: z.string().regex(/^\d{2}:\d{2}$/), note: z.string().max(120).optional() })),
    }),
  ),
});

/** OpenStreetMap 영업시간 문자열로 그 날짜·시각에 문을 여는지 (판단 불가면 null) */
export function isOpenAt(openingHours: string | undefined, date: string, time: string): boolean | null {
  if (!openingHours) return null;
  try {
    const oh = new OpeningHours(openingHours, null, 0);
    return oh.getState(new Date(`${date}T${time}:00`));
  } catch {
    return null;
  }
}

export async function replanCity(p: {
  cityName: string;
  dates: string[];
  arriveDate: string;
  hotel?: PlaceOption;
  picks: PlaceOption[];
}): Promise<{ days: DayRoute[]; unused: string[] }> {
  const items = p.picks
    .map(
      (x) =>
        `- id=${x.id} | ${x.kind === "restaurant" ? "식당" : "명소"} | ${x.name} | 좌표 ${x.lat.toFixed(4)},${x.lng.toFixed(4)}${x.category ? ` | ${x.category}` : ""}${
          x.openingHours ? ` | 영업시간(OSM) ${x.openingHours}` : x.hoursText ? ` | 영업시간 ${x.hoursText}` : ""
        }`,
    )
    .join("\n");
  const prompt = `${p.cityName} 여행 동선을 짜세요. 사용자가 직접 고른 장소만 씁니다.
날짜: ${p.dates.join(", ")} (첫날 ${p.arriveDate}은 도착일이라 14:00 이후부터)
숙소: ${p.hotel ? `${p.hotel.name} (좌표 ${p.hotel.lat.toFixed(4)},${p.hotel.lng.toFixed(4)}) — 매일 숙소에서 출발해 숙소로 돌아옴` : "아직 안 고름"}
고른 장소:
${items}

규칙:
1. 각 장소는 한 번만. 위 id만 쓰기. 하루에 너무 많으면 다른 날로 나누기.
2. 식당은 점심 11:30~14:00 또는 저녁 18:00~21:00에, 카페·디저트는 오후에.
3. 가까운 곳끼리 같은 날 묶고, 하루 안에서는 이동 거리가 짧은 순서로.
4. 영업시간이 있으면 문 여는 시각에만 배치.
5. note는 한국어 한 줄(머무는 시간이나 팁).
JSON: {"days":[{"date":"${p.dates[0]}","stops":[{"id":"","time":"10:00","note":""}]}]}`;
  const ids = new Set(p.picks.map((x) => x.id));
  const { value } = await generateJson(prompt, ReplanSchema, {
    temperature: 0.3,
    extraCheck: (v) => {
      const problems: string[] = [];
      const used = v.days.flatMap((d) => d.stops.map((s) => s.id));
      const bad = used.filter((id) => !ids.has(id));
      if (bad.length) problems.push(`목록에 없는 id: ${bad.join(", ")}`);
      const dup = used.filter((id, i) => used.indexOf(id) !== i);
      if (dup.length) problems.push(`두 번 쓴 id: ${dup.join(", ")}`);
      const badDates = v.days.filter((d) => !p.dates.includes(d.date)).map((d) => d.date);
      if (badDates.length) problems.push(`날짜는 ${p.dates.join(", ")} 중에서만: ${badDates.join(", ")}`);
      return problems;
    },
  });

  const byId = new Map(p.picks.map((x) => [x.id, x]));
  const days: DayRoute[] = p.dates.map((date) => {
    const d = value.days.find((x) => x.date === date);
    const stops = [...(d?.stops ?? [])]
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((s) => {
        const place = byId.get(s.id)!;
        const open = isOpenAt(place.openingHours, date, s.time);
        return {
          ...s,
          warning: open === false ? `지도 데이터상 ${s.time}에는 영업하지 않는 시간이에요. 시간을 바꾸거나 다른 곳을 고르세요.` : undefined,
        };
      });
    const pts = [p.hotel, ...stops.map((s) => byId.get(s.id)!), p.hotel].filter((x): x is PlaceOption => !!x);
    const walkKm = pts.slice(1).reduce((sum, x, i) => sum + distanceKm(pts[i], x), 0);
    return { date, stops, walkKm: Math.round(walkKm * 10) / 10 };
  });
  const used = new Set(days.flatMap((d) => d.stops.map((s) => s.id)));
  return { days, unused: p.picks.filter((x) => !used.has(x.id)).map((x) => x.id) };
}
