// 여행 계획 생성: 코드가 날짜·관문·금지지역을 정하고, AI는 그 틀 안에서 일정과 이동수단 후보를 채웁니다.
import "server-only";
import { z } from "zod";
import demoPlan from "@/data/demo/plan.json";
import bans from "@/data/travel-bans.json";
import { countryName } from "@/lib/countries";
import { addDays } from "@/lib/dates";
import { env } from "@/lib/env";
import { haversineKm } from "@/lib/geo";
import { gatewayInfo, hubCandidates } from "@/lib/incheon";
import { generateJson } from "@/lib/server/gemini";
import { resolveCity, SEOUL } from "@/lib/server/resolve";
import type { CityStay, DayPlan, Leg, Place, Plan, TransportCandidate, TripRequest } from "@/lib/types";

export class PlanError extends Error {
  constructor(message: string, public kind: "input" | "blocked" | "demo-only" | "ai") {
    super(message);
  }
}

/* ---------- 1. 여행금지 차단 (AI 호출 전에 코드가 먼저 막음) ---------- */
export function banBlock(p: Place): string | null {
  if (bans.bannedCountries.includes(p.country)) {
    return `${countryName(p.country)}는 외교부 여행금지 국가입니다. 허가 없이 방문하면 여권법 위반이 될 수 있어 일정을 만들지 않습니다.`;
  }
  for (const r of bans.bannedRegions) {
    if (r.scope === "whole" && r.country === p.country && p.region && r.regions.includes(p.region)) {
      return `${p.name}은(는) 외교부 여행금지 지역(${r.text})에 속합니다. 일정을 만들지 않습니다.`;
    }
  }
  return null;
}

/* ---------- 2. 체류일 배분 (코드가 결정) ---------- */
export function allocateNights(req: TripRequest): number[] {
  const given = req.cities.map((c) => (c.days && c.days > 0 ? Math.round(c.days) : 0));
  const missing = given.filter((d) => d === 0).length;
  if (!missing) return given;
  const used = given.reduce((a, b) => a + b, 0);
  const total = req.totalDays ?? used + missing * 3;
  const remain = Math.max(missing, total - used);
  const base = Math.floor(remain / missing);
  let extra = remain - base * missing;
  return given.map((d) => {
    if (d) return d;
    const v = base + (extra > 0 ? 1 : 0);
    extra--;
    return Math.max(1, v);
  });
}

/* ---------- 3. AI 출력 스키마 ---------- */
const DayItemSchema = z.object({
  slot: z.enum(["오전", "점심", "오후", "저녁", "밤"]),
  title: z.string().min(1),
  kind: z.enum(["sight", "food", "move", "rest"]),
  note: z.string().optional(),
});
const AiPlanSchema = z.object({
  cities: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      days: z.array(z.object({ date: z.string(), theme: z.string(), items: z.array(DayItemSchema).min(1) })),
    }),
  ),
  legs: z.array(
    z.object({
      index: z.number().int(),
      candidates: z
        .array(
          z.object({
            mode: z.enum(["flight", "train", "bus", "ferry", "car", "walk"]),
            description: z.string(),
            operatorHint: z.string().optional(),
            estDurationMin: z.number().optional(),
            estPriceKRW: z.number().optional(),
            borderCrossing: z.boolean().optional(),
            notes: z.string().optional(),
          }),
        )
        .min(1),
      hubSuggestions: z.array(z.string()).optional(),
    }),
  ),
  tips: z.array(z.string()).default([]),
});
type AiPlan = z.infer<typeof AiPlanSchema>;

const BUDGET_KO = { low: "아끼는 편(배낭여행)", mid: "보통", high: "여유 있게" } as const;

function buildPrompt(req: TripRequest, stays: CityStay[], legs: Leg[], hubs: string[]): string {
  const stayLines = stays
    .map(
      (s, i) =>
        `${i + 1}. ${s.place.name} (${s.place.nameEn}, ${countryName(s.place.country)}) — ${s.arrive} 도착, ${s.depart} 출발, ${s.nights}박. 일정 날짜: ${s.days
          .map((d) => d.date)
          .join(", ")}`,
    )
    .join("\n");
  const legLines = legs
    .map((l) => `leg ${l.index}: ${l.from.name}(${l.from.nameEn}) → ${l.to.name}(${l.to.nameEn}), ${l.date}, 직선거리 ${l.distanceKm}km`)
    .join("\n");
  return `당신은 한국인 여행자를 위한 여행 일정 설계자입니다. 아래 틀은 코드가 이미 확정했습니다. 틀을 바꾸지 말고 내용만 채우세요.

[여행자] ${req.travelers}명, 예산: ${BUDGET_KO[req.budget]}, 관심사: ${req.interests.join(", ") || "특별히 없음"}

[도시별 체류 (순서·날짜 고정)]
${stayLines}

[이동 구간 (순서 고정)]
${legLines}

[인천 노선표의 환승 허브 후보 IATA] ${hubs.join(", ")}

출력 규칙:
1. cities 배열은 위 도시 순서와 이름 그대로, days 배열은 위에 적힌 날짜 그대로 하나씩 만드세요.
2. 하루 items는 오전/점심/오후/저녁 중심으로 3~5개. 실제로 존재하는 유명 명소만 쓰고, 확실하지 않으면 지역 이름(예: "구시가지 산책")으로 쓰세요.
3. 식사(kind "food")에는 식당 이름을 절대 쓰지 말고 음식 종류만 쓰세요(예: "에스토니아 전통 요리"). 실제 식당은 앱이 지도 데이터에서 따로 찾습니다.
4. legs 배열은 위 구간마다 하나씩, index를 그대로 쓰세요. 각 구간에 현실적인 이동수단 후보 1~3개를 넣으세요.
   - 서울(인천)이 포함된 구간에는 반드시 mode "flight" 후보를 넣고, hubSuggestions에 위 허브 후보 중 검색해 볼 만한 곳을 최대 2개 고르세요.
   - 국경을 넘으면 borderCrossing: true. 운행 여부가 불확실한 노선은 notes에 "운행 여부 확인 필요"라고 쓰세요.
   - estDurationMin(분), estPriceKRW(1인 원화)는 대략적인 추정치입니다.
5. tips에는 이 여정 전체에 필요한 실용 팁 3~5개(결제수단, 통신, 치안 등)를 쓰세요.

JSON 형식:
{"cities":[{"name":"","summary":"","days":[{"date":"YYYY-MM-DD","theme":"","items":[{"slot":"오전","title":"","kind":"sight","note":""}]}]}],
 "legs":[{"index":0,"candidates":[{"mode":"flight","description":"","operatorHint":"","estDurationMin":0,"estPriceKRW":0,"borderCrossing":true,"notes":""}],"hubSuggestions":["IST"]}],
 "tips":[""]}`;
}

function checkAiPlan(ai: AiPlan, stays: CityStay[], legs: Leg[], hubs: string[]): string[] {
  const problems: string[] = [];
  if (ai.cities.length !== stays.length) problems.push(`cities는 ${stays.length}개여야 합니다 (받은 개수 ${ai.cities.length}).`);
  stays.forEach((s, i) => {
    const c = ai.cities[i];
    if (!c) return;
    const want = s.days.map((d) => d.date).join(",");
    const got = c.days.map((d) => d.date).join(",");
    if (want !== got) problems.push(`${s.place.name}의 날짜는 [${want}]여야 합니다.`);
  });
  if (ai.legs.length !== legs.length) problems.push(`legs는 ${legs.length}개여야 합니다.`);
  for (const l of legs) {
    const a = ai.legs.find((x) => x.index === l.index);
    if (!a) {
      problems.push(`leg ${l.index}가 없습니다.`);
      continue;
    }
    const touchesSeoul = l.from.country === "KR" || l.to.country === "KR";
    if (touchesSeoul && !a.candidates.some((c) => c.mode === "flight")) problems.push(`leg ${l.index}에는 flight 후보가 필요합니다.`);
    const badHubs = (a.hubSuggestions ?? []).filter((h) => !hubs.includes(h));
    if (badHubs.length) problems.push(`leg ${l.index}의 hubSuggestions ${badHubs.join(",")}는 허브 후보 목록에 없습니다.`);
  }
  return problems;
}

/* ---------- 4. 틀 만들기 ---------- */
function skeleton(req: TripRequest, places: Place[]) {
  const nights = allocateNights(req);
  const stays: CityStay[] = [];
  let cursor = req.startDate;
  places.forEach((p, i) => {
    const arrive = cursor;
    const depart = addDays(arrive, nights[i]);
    const days: DayPlan[] = Array.from({ length: nights[i] }, (_, k) => ({ date: addDays(arrive, k), theme: "", items: [] }));
    stays.push({ place: p, arrive, depart, nights: nights[i], summary: "", days });
    cursor = depart;
  });
  const chain = [SEOUL, ...places, SEOUL];
  const legs: Leg[] = chain.slice(0, -1).map((from, i) => ({
    index: i,
    from,
    to: chain[i + 1],
    date: i === 0 ? req.startDate : stays[i - 1].depart,
    distanceKm: haversineKm(from, chain[i + 1]),
    candidates: [],
  }));
  return { stays, legs };
}

function withIds(legIndex: number, cands: Omit<TransportCandidate, "id">[]): TransportCandidate[] {
  return cands.map((c, k) => ({ ...c, id: `L${legIndex}-${k}` }));
}

/* ---------- 5. 데모 데이터 ---------- */
const DEMO_CITIES = demoPlan.cities.map((c) => c.name);
function isDemoRoute(places: Place[]) {
  return places.length === DEMO_CITIES.length && places.every((p, i) => p.name === DEMO_CITIES[i]);
}

function applyDemo(stays: CityStay[], legs: Leg[]) {
  stays.forEach((s, i) => {
    const src = demoPlan.cities[i];
    s.summary = src.summary;
    s.days = s.days.map((d, k) => {
      const t = src.days[k];
      return t
        ? { date: d.date, theme: t.theme, items: t.items as DayPlan["items"] }
        : { date: d.date, theme: "자유 일정", items: [{ slot: "오전", title: "자유 일정", kind: "rest" }] };
    });
  });
  const hubSuggestions: Record<number, string[]> = {};
  legs.forEach((l) => {
    const src = demoPlan.legs.find((x) => x.index === l.index);
    l.candidates = withIds(l.index, (src?.candidates ?? []) as Omit<TransportCandidate, "id">[]);
    hubSuggestions[l.index] = src?.hubSuggestions ?? [];
  });
  return { tips: demoPlan.tips, hubSuggestions };
}

/* ---------- 6. 진입점 ---------- */
export async function buildPlan(req: TripRequest): Promise<Plan & { hubSuggestions: Record<number, string[]> }> {
  if (!req.cities.length) throw new PlanError("도시를 하나 이상 입력하세요.", "input");
  if (req.cities.length > 8) throw new PlanError("도시는 8개까지 넣을 수 있습니다.", "input");

  const places = await Promise.all(req.cities.map((c) => resolveCity(c.name)));
  const missing = req.cities.filter((_, i) => !places[i]).map((c) => c.name);
  if (missing.length) throw new PlanError(`도시를 찾지 못했습니다: ${missing.join(", ")}. 영어 이름으로 다시 입력해 보세요.`, "input");
  const resolved = places as Place[];

  for (const p of resolved) {
    const reason = banBlock(p);
    if (reason) throw new PlanError(reason, "blocked");
  }

  const { stays, legs } = skeleton(req, resolved);
  const gateways = [resolved[0], resolved[resolved.length - 1]]
    .filter((p, i, arr) => arr.findIndex((q) => q.name === p.name) === i)
    .map((p) => gatewayInfo(p));
  const hubs = hubCandidates().map((h) => h.iata);
  const validation: string[] = [];

  if (!env.geminiKey) {
    if (!isDemoRoute(resolved)) {
      throw new PlanError(
        `데모 모드에서는 예시 여정(${DEMO_CITIES.join(" → ")})만 만들 수 있습니다. 다른 여정은 .env.local에 GEMINI_API_KEY를 넣어 주세요.`,
        "demo-only",
      );
    }
    const { tips, hubSuggestions } = applyDemo(stays, legs);
    return { mode: "demo", request: req, origin: SEOUL, stays, legs, gateways, tips, generatedBy: "demo-sample", validation, hubSuggestions };
  }

  const prompt = buildPrompt(req, stays, legs, hubs);
  let result;
  try {
    result = await generateJson(prompt, AiPlanSchema, { extraCheck: (v) => checkAiPlan(v, stays, legs, hubs), retries: 1 });
  } catch (e) {
    throw new PlanError((e as Error).message, "ai");
  }
  validation.push(...result.fixes);
  const ai = result.value;
  stays.forEach((s, i) => {
    s.summary = ai.cities[i].summary;
    s.days = ai.cities[i].days as DayPlan[];
  });
  const hubSuggestions: Record<number, string[]> = {};
  legs.forEach((l) => {
    const a = ai.legs.find((x) => x.index === l.index)!;
    l.candidates = withIds(l.index, a.candidates);
    hubSuggestions[l.index] = a.hubSuggestions ?? [];
  });
  return {
    mode: "live",
    request: req,
    origin: SEOUL,
    stays,
    legs,
    gateways,
    tips: ai.tips,
    generatedBy: env.geminiModel,
    validation,
    hubSuggestions,
  };
}
