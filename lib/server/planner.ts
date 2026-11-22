// 여행 계획 생성: 코드가 날짜·관문·금지지역을 정하고, AI는 그 틀 안에서 일정과 이동수단 후보를 채웁니다.
import "server-only";
import { z } from "zod";
import demoPlan from "@/data/demo/plan.json";
import cityMenu from "@/data/city-menu.json";
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
const cut = (n: number) => z.string().transform((s) => (s.length > n ? s.slice(0, n - 1) + "…" : s));
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DayItemSchema = z.object({
  slot: z.enum(["오전", "점심", "오후", "저녁", "밤"]),
  title: z.string().min(1),
  kind: z.enum(["sight", "food", "move", "rest"]),
  note: z.string().optional(),
  placeEn: cut(120).optional(),
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().catch(undefined),
  durationMin: z.number().int().min(10).max(600).optional().catch(undefined),
  desc: cut(260).optional(),
  tips: z.array(cut(110)).optional().transform((t) => t?.slice(0, 3)),
  costKRW: z.number().min(0).max(1000000).optional().catch(undefined),
  menu: z.array(cut(40)).optional().transform((t) => t?.slice(0, 4)),
  closedDays: z.array(z.string()).optional().transform((d) => d?.map((x) => x.trim().slice(0, 1)).filter((x) => WEEKDAYS.includes(x))),
  moveNext: cut(60).optional(),
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


const CitySchema = z.object({
  summary: z.string(),
  estLodgingPerNightKRW: z.number().min(0).optional(),
  estOtherPerDayKRW: z.number().min(0).optional(),
  days: z.array(z.object({ date: z.string(), theme: z.string(), intro: cut(300).optional(), area: cut(60).optional(), items: z.array(DayItemSchema).min(1) })),
});

/** 코드 검사: 시간순 정렬, 휴무 요일과 실제 날짜 비교 */
export function polishDays(days: DayPlan[], mealBudgetKRW?: number): DayPlan[] {
  const mins = (t?: string) => (t ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : NaN);
  return days.map((d) => {
    const wd = WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
    const items = d.items.every((i) => i.time) ? [...d.items].sort((a, b) => mins(a.time) - mins(b.time)) : d.items;
    return {
      ...d,
      items: items.map((it) => {
        // 식사 메뉴를 note에 적은 경우 메뉴로 옮김 (숫자 없는 쉼표 목록)
        const menu = it.menu?.length ? it.menu : it.kind === "food" && it.note && it.note.includes(",") && !/\d/.test(it.note) ? it.note.split(",").map((x) => x.trim()).filter(Boolean) : it.menu;
        const note = menu !== it.menu ? undefined : it.note;
        const closed = it.closedDays?.includes(wd) ? `이 날은 ${wd}요일이에요. ${it.closedDays.join("·")}요일은 정기 휴무일 수 있으니 다른 날로 옮기거나 미리 확인하세요.` : undefined;
        const pricey = it.kind === "food" && mealBudgetKRW && it.costKRW && it.costKRW > mealBudgetKRW * 1.2 ? `예상 식비(${it.costKRW.toLocaleString("ko-KR")}원)가 1끼 상한보다 높아요.` : undefined;
        return { ...it, menu, note, time: it.time ? it.time.padStart(5, "0") : undefined, warning: [closed, pricey].filter(Boolean).join(" ") || undefined };
      }),
    };
  });
}
const LegsSchema = AiPlanSchema.pick({ legs: true, tips: true });

const LODGING_KO: Record<string, string> = { any: "상관없음", hostel: "호스텔·게스트하우스", "3": "3성급", "4": "4성급", "5": "5성급" };

function travelerLine(req: TripRequest) {
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
  return `[여행자] ${req.travelers}명, 1인 총예산(항공·교통·숙박·식비 포함): ${won(req.budgetKRW)} (± ${won(req.budgetToleranceKRW)}), 숙소 등급: ${
    LODGING_KO[req.lodgingClass] ?? "상관없음"
  }, 1인 1끼 식비 상한: ${won(req.mealBudgetKRW)}${req.mealBudgetKRW >= 150000 ? " (미슐랭·파인다이닝 희망)" : ""}, 관심사: ${req.interests.join(", ") || "특별히 없음"}`;
}

/** 도시 하나의 일정만 만드는 짧은 프롬프트 (여러 도시를 동시에 요청해 빠르게) */
function cityPrompt(req: TripRequest, s: CityStay, i: number, total: number): string {
  return `당신은 한국인의 유럽 여행 일정 설계자입니다. 전체 ${total}개 도시 중 ${i + 1}번째 도시의 일정만 만드세요.
${travelerLine(req)}
[도시] ${s.place.name} (${s.place.nameEn}, ${countryName(s.place.country)}) — ${s.arrive} 도착, ${s.depart} 출발, ${s.nights}박
[일정 날짜 (이 날짜 그대로, 하나씩)] ${s.days.map((d) => d.date).join(", ")}

규칙:
- 하루 items는 오전/점심/오후/저녁 중심으로 4~6개(식사 포함). 첫날은 도착일이라 오후부터 시작하세요.
- 각 날짜: theme(짧은 제목), area(주로 다니는 동네), intro(왜 이 순서로 도는지, 오늘의 흐름을 2문장).
- 각 항목: time(시작 "HH:MM"), durationMin(머무는 분), desc(무엇을 보고 하는지, 왜 가볼 만한지 2~3문장, 구체적으로), moveNext(다음 항목까지 가는 방법과 대략 시간, 예: "도보 12분", "메트로 1호선 15분". 마지막 항목은 숙소까지).
- tips: 확실한 실용 팁만 0~2개 (사전 예약 필요, 줄이 짧은 시간대, 무료 입장일, 복장 규정 등). 모르면 비우세요.
- 명소: costKRW에 1인 성인 입장료(원, 무료면 0, 모르면 생략), closedDays에 정기 휴무 요일("월"~"일", 확실할 때만). 휴무 요일에는 그 명소를 넣지 마세요(각 날짜의 요일: ${s.days.map((d) => `${d.date}=${"일월화수목금토"[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}`).join(", ")}).
- 식사: desc에 그 음식이 어떤 음식인지, menu에 먹어볼 대표 메뉴 2~3개, costKRW에 1인 예상 식사비(원).
- 실제로 존재하는 유명 명소만 쓰고, 확실하지 않으면 지역 이름(예: "구시가지 산책")으로 쓰세요.
- 식사(kind "food")에는 식당 이름을 절대 쓰지 말고 음식 종류만 쓰세요.
- 명소(kind "sight")는 한 항목에 한 곳만 쓰고, placeEn에 지도에서 찾을 수 있는 현지어 또는 영어 공식 이름을 적으세요(예: "Musée du Louvre").
- 예산에 맞는 숙소·식사 수준을 고르세요.
- summary는 이 도시 일정의 흐름을 한국어 1~2문장으로.
- estLodgingPerNightKRW: 이 도시에서 위 숙소 등급으로 1박 숙소비(1인 기준, 원) 추정.
- estOtherPerDayKRW: 하루 입장료·시내교통 합계(1인, 원) 추정. 식비와 숙소비, 도시 간 이동비는 빼세요.
- 식사는 1끼 식비 상한에 맞는 수준으로 고르세요.
JSON: {"summary":"","estLodgingPerNightKRW":0,"estOtherPerDayKRW":0,"days":[{"date":"YYYY-MM-DD","theme":"","area":"","intro":"","items":[{"slot":"오전","time":"09:30","durationMin":120,"title":"","kind":"sight","placeEn":"","desc":"","tips":[""],"costKRW":0,"closedDays":[],"moveNext":"","note":""}]}]}`;
}

/** 구간별 이동수단 후보와 팁만 만드는 프롬프트 */
function legsPrompt(req: TripRequest, legs: Leg[], hubs: string[]): string {
  const legLines = legs
    .map((l) => `leg ${l.index}: ${l.from.name}(${l.from.nameEn}) → ${l.to.name}(${l.to.nameEn}), ${l.date}, 직선거리 ${l.distanceKm}km`)
    .join("\n");
  return `당신은 한국인 여행자를 위한 교통 전문가입니다. 아래 이동 구간마다 현실적인 이동수단 후보를 제안하세요.
${travelerLine(req)}
[이동 구간 (순서 고정)]
${legLines}
[인천 노선표의 환승 허브 후보 IATA] ${hubs.join(", ")}

규칙:
- legs 배열은 위 구간마다 하나씩, index를 그대로. 각 구간에 후보 1~3개.
- 서울(인천)이 포함된 구간에는 반드시 mode "flight" 후보를 넣고, hubSuggestions에 위 허브 후보 중 검색해 볼 만한 곳을 최대 2개.
- 국경을 넘으면 borderCrossing: true. 운행 여부가 불확실하면 notes에 "운행 여부 확인 필요".
- estDurationMin(분), estPriceKRW(1인 원화)는 대략적인 추정치.
- tips: 이 여정 전체에 필요한 실용 팁 3~5개(결제수단, 통신, 치안 등).
JSON: {"legs":[{"index":0,"candidates":[{"mode":"flight","description":"","operatorHint":"","estDurationMin":0,"estPriceKRW":0,"borderCrossing":true,"notes":""}],"hubSuggestions":["IST"]}],"tips":[""]}`;
}

function checkAiPlan(ai: AiPlan, stays: CityStay[], legs: Leg[], hubs: string[]): string[] {
  const problems: string[] = [];
  if (ai.cities.length !== stays.length) problems.push(`cities는 ${stays.length}개여야 합니다 (받은 개수 ${ai.cities.length}).`);
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

function checkCity(v: z.infer<typeof CitySchema>, s: CityStay): string[] {
  const want = s.days.map((d) => d.date).join(",");
  const got = v.days.map((d) => d.date).join(",");
  return want === got ? [] : [`days의 날짜는 [${want}]여야 합니다.`];
}

/** 코드 검사: AI가 스스로 적은 휴무 요일에 그 명소를 배치했으면 한 번 다시 짜게 함 (그래도 남으면 경고로 표시) */
function closedDayClash(v: z.infer<typeof CitySchema>): string[] {
  const clash = v.days.flatMap((d) => {
    const wd = WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
    return d.items.filter((it) => it.closedDays?.includes(wd)).map((it) => `${d.date}(${wd}요일)에 넣은 "${it.title}"은 ${wd}요일 휴무입니다. 다른 날과 바꾸거나, 그날 문을 여는 다른 명소로 바꾸세요.`);
  });
  return clash;
}

function checkLegs(v: z.infer<typeof LegsSchema>, legs: Leg[], hubs: string[]): string[] {
  return checkAiPlan({ cities: [], legs: v.legs, tips: v.tips }, [], legs, hubs);
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
  // 이 앱은 유럽 전용: 화면의 나라 목록에 있는 나라만 받음
  const europe = Object.keys(cityMenu.menu);
  const outside = req.cities.filter((c) => !c.country || !europe.includes(c.country));
  if (outside.length) throw new PlanError("이 앱은 유럽 여행 전용입니다. 나라 목록에서 유럽 나라를 골라 주세요.", "input");

  const places = await Promise.all(req.cities.map((c) => resolveCity(c.name, c.country, c.geo)));
  const missing = req.cities.filter((_, i) => !places[i]).map((c) => (c.country ? `${c.name}(${countryName(c.country)})` : c.name));
  if (missing.length)
    throw new PlanError(`도시를 찾지 못했습니다: ${missing.join(", ")}. 고른 나라에 있는 도시인지 확인하고, 직접 입력했다면 영어 이름으로 다시 넣어 보세요.`, "input");
  const resolved = places as Place[];

  const blocked = [...new Set(resolved.map(banBlock).filter((x): x is string => !!x))];
  if (blocked.length) throw new PlanError(blocked.join(" "), "blocked");

  const { stays, legs } = skeleton(req, resolved);
  const gateways = [resolved[0], resolved[resolved.length - 1]]
    .filter((p, i, arr) => arr.findIndex((q) => q.name === p.name) === i)
    .map((p) => gatewayInfo(p));
  const hubs = hubCandidates().map((h) => h.iata);
  const validation: string[] = [];

  if (!env.geminiKey) {
    if (!isDemoRoute(resolved)) {
      throw new PlanError(
        `AI 키가 없는 데모 모드에서는 예시 여정(${DEMO_CITIES.join(" → ")})만 만들 수 있습니다. 다른 여정은 GEMINI_API_KEY를 넣어 주세요.`,
        "demo-only",
      );
    }
    const { tips, hubSuggestions } = applyDemo(stays, legs);
    return { mode: "demo", request: req, origin: SEOUL, stays, legs, gateways, tips, generatedBy: "demo-sample", validation, hubSuggestions };
  }

  // 도시별 일정과 이동수단을 따로 요청해 동시에 실행 (한 번에 다 만들면 느려서 시간 초과가 남)
  const jobs: (() => Promise<void>)[] = []; // 이동 구간(필수)을 먼저, 도시 일정을 그다음에
  const hubSuggestions: Record<number, string[]> = {};
  let tips: string[] = [];
  stays.forEach((s, i) =>
    jobs.push(async () => {
      try {
        const r = await generateJson(cityPrompt(req, s, i, stays.length), CitySchema, { extraCheck: (v) => checkCity(v, s), softCheck: closedDayClash, retries: 1 });
        if (r.fixes.length) validation.push(`${s.place.name}: ${r.fixes.join(" / ")}`);
        s.summary = r.value.summary;
        s.days = polishDays(r.value.days as DayPlan[], req.mealBudgetKRW);
        s.estLodgingPerNightKRW = r.value.estLodgingPerNightKRW;
        s.estOtherPerDayKRW = r.value.estOtherPerDayKRW;
      } catch (e) {
        // 도시 하나가 실패해도 나머지 결과는 보여줌 (이동·출입국·항공은 그대로 계산)
        validation.push(`${s.place.name}: AI 일정 생성 실패 — ${(e as Error).message}`);
        s.summary = "AI 서버가 붐벼서 이 도시의 하루 일정을 만들지 못했습니다. 잠시 뒤 다시 만들기를 눌러 주세요.";
        s.days = s.days.map((d) => ({ date: d.date, theme: "일정 생성 실패", items: [{ slot: "오전", title: "잠시 뒤 다시 시도하세요", kind: "rest" }] }));
      }
    }),
  );
  jobs.unshift(async () => {
    const r = await generateJson(legsPrompt(req, legs, hubs), LegsSchema, { extraCheck: (v) => checkLegs(v, legs, hubs), retries: 1 });
    if (r.fixes.length) validation.push(`이동 구간: ${r.fixes.join(" / ")}`);
    legs.forEach((l) => {
      const a = r.value.legs.find((x) => x.index === l.index)!;
      l.candidates = withIds(l.index, a.candidates);
      hubSuggestions[l.index] = a.hubSuggestions ?? [];
    });
    tips = r.value.tips;
  });
  try {
    const queue = [...jobs];
    // 무료 등급 분당 요청 한도를 고려해 동시에 2개까지
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (queue.length) await queue.shift()!();
    }));
  } catch (e) {
    throw new PlanError((e as Error).message, "ai");
  }
  return {
    mode: "live",
    request: req,
    origin: SEOUL,
    stays,
    legs,
    gateways,
    tips,
    generatedBy: env.geminiModel,
    validation,
    hubSuggestions,
  };
}
