// 교통편 운행 검증
// 1) 출처로 확인해 둔 지식베이스(data/transport-kb.json) → 2) 웹 검색(Tavily) + AI 판정 → 3) 둘 다 없으면 "확인 불가"
// AI에게는 URL을 쓰게 하지 않고 "검색 결과 번호"만 고르게 해서, 존재하지 않는 출처를 지어낼 수 없게 했습니다.
import "server-only";
import { z } from "zod";
import kb from "@/data/transport-kb.json";
import { cached, DAY } from "@/lib/cache";
import { env } from "@/lib/env";
import { generateJson } from "@/lib/server/gemini";
import type { Leg, SourceRef, TransportCandidate, VerifyResult, VerifyStatus } from "@/lib/types";

type KbEntry = (typeof kb.entries)[number] & { keywords?: string[]; excludeKeywords?: string[] };

const KB_CHECKED = "2026-11-21"; // 지식베이스 출처를 마지막으로 확인한 날짜
const GROUND = new Set(["train", "bus", "car", "walk", "ferry"]);
const MODE_EN: Record<string, string> = { flight: "flight", train: "train", bus: "bus", ferry: "ferry", car: "drive", walk: "walk" };

function textOf(c: TransportCandidate) {
  return `${c.description} ${c.operatorHint ?? ""} ${c.notes ?? ""}`.toLowerCase();
}

export function matchKnowledgeBase(leg: Leg, c: TransportCandidate): KbEntry | null {
  const text = textOf(c);
  const pair = [leg.from.country, leg.to.country].sort().join("-");
  const names = [leg.from.nameEn, leg.to.nameEn];
  for (const e of kb.entries as KbEntry[]) {
    if (e.keywords?.some((k) => text.includes(k.toLowerCase()))) return e;
  }
  for (const e of kb.entries as KbEntry[]) {
    if (e.keywords) continue;
    if (e.excludeKeywords?.some((k) => text.includes(k.toLowerCase()))) continue;
    if ([...e.between].sort().join("-") !== pair) continue;
    const modeOk = e.mode === "land" ? GROUND.has(c.mode) && c.mode !== "ferry" : e.mode === c.mode;
    if (!modeOk) continue;
    const cities = (e as { cities?: string[] }).cities;
    if (cities && !names.every((n) => cities.includes(n))) continue;
    return e;
  }
  return null;
}

/* ---------- Tavily 검색 ---------- */
export interface SearchHit {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

export async function webSearch(query: string): Promise<SearchHit[]> {
  return cached(`tavily:${query}`, DAY, async () => {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.tavilyKey}` },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 6, include_answer: false }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Tavily 오류 ${res.status}`);
    const data = (await res.json()) as { results?: SearchHit[] };
    return data.results ?? [];
  });
}

export function buildQuery(leg: Leg, c: TransportCandidate): string {
  const year = new Date().getUTCFullYear();
  return `${leg.from.nameEn} to ${leg.to.nameEn} ${MODE_EN[c.mode]} ${c.operatorHint ?? ""} ${year} schedule suspended or operating`
    .replace(/\s+/g, " ")
    .trim();
}

const JudgeSchema = z.object({
  status: z.enum(["operating", "conditional", "changed", "suspended", "unknown"]),
  summary: z.string(),
  sourceIndexes: z.array(z.number().int()).default([]),
});

function judgePrompt(leg: Leg, c: TransportCandidate, hits: SearchHit[], today: string) {
  const list = hits
    .map((h, i) => `[${i}] ${h.title}\n날짜: ${h.published_date ?? "모름"}\nURL: ${h.url}\n내용: ${h.content.slice(0, 700)}`)
    .join("\n\n");
  return `오늘은 ${today}입니다. 아래 교통편이 "지금" 운행 중인지 검색 결과만 근거로 판정하세요. 당신의 기억은 쓰지 마세요.

[교통편] ${leg.from.nameEn} → ${leg.to.nameEn}, 수단: ${c.mode}, 설명: ${c.description}, 운영사: ${c.operatorHint ?? "모름"}

[검색 결과]
${list}

status 기준:
- operating: 최근 자료가 정상 운행을 보여줌
- conditional: 운행하지만 조건이 있음(국경 도보 통과, 운영시간 단축, 계절 운행 등)
- changed: 최근 노선·시간·운영사가 바뀜
- suspended: 운행 중단
- unknown: 검색 결과로 판단할 수 없음 (근거가 없거나 오래됐거나 서로 모순)
summary: 한국어 1~2문장. sourceIndexes: 판정 근거가 된 검색 결과 번호(위 대괄호 숫자)만. 근거가 없으면 status는 unknown.
JSON: {"status":"","summary":"","sourceIndexes":[0]}`;
}

export async function judgeWithSearch(leg: Leg, c: TransportCandidate): Promise<Omit<VerifyResult, "legIndex" | "candidateId">> {
  const hits = await webSearch(buildQuery(leg, c));
  const today = new Date().toISOString().slice(0, 10);
  if (!hits.length) {
    return { status: "unknown", summary: "검색 결과가 없어 판단하지 못했습니다.", sources: [], method: "search+ai", checkedAt: today };
  }
  const { value } = await generateJson(judgePrompt(leg, c, hits, today), JudgeSchema, { temperature: 0.1 });
  const valid = value.sourceIndexes.filter((i) => i >= 0 && i < hits.length);
  const rejected = value.sourceIndexes.filter((i) => !(i >= 0 && i < hits.length)).map(String);
  const sources: SourceRef[] = valid.map((i) => ({ title: hits[i].title, url: hits[i].url, date: hits[i].published_date }));
  let status: VerifyStatus = value.status;
  let summary = value.summary;
  if (status !== "unknown" && sources.length === 0) {
    status = "unknown";
    summary = "AI가 근거를 제시하지 못해 판정을 보류했습니다. " + summary;
  }
  return { status, summary, sources, method: "search+ai", checkedAt: today, rejectedUrls: rejected.length ? rejected : undefined };
}

/** 실험 A용: 검색 없이 AI 기억만으로 판정 */
export async function judgeWithoutSearch(leg: Leg, c: TransportCandidate) {
  const schema = z.object({ status: JudgeSchema.shape.status, summary: z.string() });
  const prompt = `${leg.from.nameEn} → ${leg.to.nameEn} 구간의 ${c.mode} (${c.description}, 운영사 ${c.operatorHint ?? "모름"})가 오늘(${new Date()
    .toISOString()
    .slice(0, 10)}) 운행 중인지 판정하세요. status는 operating/conditional/changed/suspended/unknown 중 하나.
JSON: {"status":"","summary":""}`;
  return (await generateJson(prompt, schema, { temperature: 0.1 })).value;
}

export async function verifyCandidate(leg: Leg, c: TransportCandidate): Promise<VerifyResult> {
  const today = new Date().toISOString().slice(0, 10);
  const base = { legIndex: leg.index, candidateId: c.id };

  if (c.mode === "flight") {
    return { ...base, status: "unknown", summary: "항공편은 아래 항공권 검색 결과로 확인합니다.", sources: [], method: "none", checkedAt: today };
  }

  const hit = matchKnowledgeBase(leg, c);
  if (hit) {
    return {
      ...base,
      status: hit.status as VerifyStatus,
      summary: `${hit.name}: ${hit.summary}`,
      sources: hit.sources as SourceRef[],
      method: "knowledge-base",
      checkedAt: KB_CHECKED,
    };
  }

  if (!env.tavilyKey || !env.geminiKey) {
    return {
      ...base,
      status: "unknown",
      summary: "검색 키(TAVILY_API_KEY, GEMINI_API_KEY)가 없어 운행 여부를 확인하지 못했습니다. 운영사 사이트에서 직접 확인하세요.",
      sources: [],
      method: "none",
      checkedAt: today,
    };
  }

  try {
    return { ...base, ...(await judgeWithSearch(leg, c)) };
  } catch (e) {
    return { ...base, status: "unknown", summary: `확인 중 오류: ${(e as Error).message}`, sources: [], method: "none", checkedAt: today };
  }
}
