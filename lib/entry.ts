// 출입국 규칙 엔진 (AI를 쓰지 않는 규칙 기반 코드)
// 비자·체류일·여행금지는 틀리면 위험한 정보라 AI 판단에 맡기지 않고, 출처가 있는 데이터와 계산으로만 결정합니다.
import { chinaTransitNote } from "@/lib/transit";
import bans from "@/data/travel-bans.json";
import kb from "@/data/transport-kb.json";
import rules from "@/data/entry-rules.json";
import { countryName, isSchengen, zoneOf } from "@/lib/countries";
import { diffDays, eachDay } from "@/lib/dates";
import type { EntryCheck, SourceRef } from "@/lib/types";

export interface StayInput {
  name: string;
  country: string;
  region?: string;
  arrive: string;
  depart: string;
}
export interface LegInput {
  fromCountry: string;
  toCountry: string;
  mode: string; // 선택된 이동수단
}

type Rule = {
  visaFree: boolean | null;
  maxStayDays?: number;
  windowDays?: number;
  windowMaxDays?: number;
  summary: string;
  notes?: string[];
  requiresPreAuth?: string;
  validUntil?: string;
  sources?: SourceRef[];
  confidence: "verified" | "baseline" | "unknown";
};
const COUNTRY_RULES = rules.countries as Record<string, Rule>;
const SCHENGEN_RULE = rules.groups.SCHENGEN as Rule;
const MOFA_LINK: SourceRef = { title: "외교부 해외안전여행 – 국가별 입국 정보", url: "https://www.0404.go.kr" };

const CONF_KO = { verified: "출처 확인됨", baseline: "기본 데이터 · 출발 전 재확인 필요", unknown: "앱이 판단하지 않음" } as const;

/** 같은 나라에 연속으로 머문 구간을 하나의 입국으로 묶음 */
export function groupEntries(stays: StayInput[]) {
  const out: { country: string; arrive: string; depart: string; cities: string[] }[] = [];
  for (const s of stays) {
    const last = out[out.length - 1];
    if (last && last.country === s.country && last.depart === s.arrive) {
      last.depart = s.depart;
      last.cities.push(s.name);
    } else out.push({ country: s.country, arrive: s.arrive, depart: s.depart, cities: [s.name] });
  }
  return out;
}

/** 입국일·출국일을 모두 포함한 체류일 수 (쉥겐 계산 방식) */
export function stayDaysInclusive(arrive: string, depart: string) {
  return diffDays(arrive, depart) + 1;
}

/** 180일 이동 창 안에서 가장 많이 머문 날 수 */
export function maxDaysInWindow(dates: string[], windowDays: number): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  for (let i = 0; i < sorted.length; i++) {
    let count = 0;
    for (let j = i; j < sorted.length && diffDays(sorted[i], sorted[j]) < windowDays; j++) count++;
    best = Math.max(best, count);
  }
  return best;
}

export function runEntryChecks(stays: StayInput[], legs: LegInput[], transitCountries: string[] = [], transitDates: Record<string, string> = {}): EntryCheck[] {
  const checks: EntryCheck[] = [];
  const entries = groupEntries(stays);
  const countries = [...new Set(stays.map((s) => s.country))];

  /* 1. 여행금지 */
  for (const s of stays) {
    if (bans.bannedCountries.includes(s.country)) {
      checks.push({ level: "block", country: s.country, title: `${countryName(s.country)}: 여행금지 국가`, detail: "외교부 여행금지 국가입니다. 허가 없이 방문할 수 없습니다.", sources: [bans.source] });
    }
    for (const r of bans.bannedRegions) {
      if (r.country !== s.country || !s.region || !r.regions.includes(s.region)) continue;
      checks.push({
        level: r.scope === "whole" ? "block" : "warn",
        country: s.country,
        title: `${s.name}: 여행금지 구역이 있는 지역`,
        detail:
          r.scope === "whole"
            ? `${r.text}은 여행금지 지역입니다.`
            : `${s.name}이(가) 속한 지역에 여행금지 구역(${r.text})이 있습니다. 앱은 정확한 30km 경계를 판정하지 못하므로, 숙소·이동 경로가 국경 30km 안에 들어가지 않는지 반드시 확인하세요.`,
        sources: [bans.source],
      });
    }
  }

  /* 2. 쉥겐 합산 */
  const schengenDates = entries.filter((e) => isSchengen(e.country)).flatMap((e) => eachDay(e.arrive, e.depart));
  if (schengenDates.length) {
    const used = maxDaysInWindow(schengenDates, SCHENGEN_RULE.windowDays!);
    const max = SCHENGEN_RULE.maxStayDays!;
    const names = [...new Set(entries.filter((e) => isSchengen(e.country)).map((e) => countryName(e.country)))].join(", ");
    checks.push({
      level: used > max ? "block" : "ok",
      title: `쉥겐 지역 체류 ${used}일 / ${max}일`,
      detail: `${names} 체류를 합산했습니다 (입국일·출국일 포함). ${SCHENGEN_RULE.summary}. 이번 여행 전 180일 안의 쉥겐 체류 이력은 반영하지 않았습니다.`,
      sources: SCHENGEN_RULE.sources,
    });
    for (const n of SCHENGEN_RULE.notes ?? []) checks.push({ level: "info", title: "쉥겐 입국 안내", detail: n, sources: SCHENGEN_RULE.sources });
  }

  /* 3. 나라별 규칙 */
  for (const c of countries) {
    if (c === "KR" || isSchengen(c)) continue;
    const rule = COUNTRY_RULES[c];
    const myEntries = entries.filter((e) => e.country === c);
    if (!rule) {
      checks.push({ level: "warn", country: c, title: `${countryName(c)}: 앱에 입국 규칙이 없습니다`, detail: "외교부 해외안전여행에서 비자 필요 여부를 확인하세요.", sources: [MOFA_LINK] });
      continue;
    }
    if (rule.visaFree === null) {
      checks.push({ level: "warn", country: c, title: `${countryName(c)}: 확인 필요`, detail: rule.summary, sources: [...(rule.sources ?? []), MOFA_LINK] });
    } else {
      for (const e of myEntries) {
        const days = stayDaysInclusive(e.arrive, e.depart);
        const over = rule.maxStayDays !== undefined && days > rule.maxStayDays;
        checks.push({
          level: over ? "block" : "ok",
          country: c,
          title: `${countryName(c)} 체류 ${days}일${rule.maxStayDays ? ` / 1회 ${rule.maxStayDays}일` : ""}`,
          detail: `${rule.summary} (${CONF_KO[rule.confidence]})`,
          sources: [...(rule.sources ?? []), MOFA_LINK],
        });
      }
      if (rule.windowMaxDays && rule.windowDays) {
        const dates = myEntries.flatMap((e) => eachDay(e.arrive, e.depart));
        const used = maxDaysInWindow(dates, rule.windowDays);
        if (used > rule.windowMaxDays) {
          checks.push({ level: "block", country: c, title: `${countryName(c)}: ${rule.windowDays}일 중 ${rule.windowMaxDays}일 초과`, detail: `이번 일정 합계 ${used}일입니다.` });
        }
      }
    }
    if (rule.requiresPreAuth) {
      checks.push({ level: "info", country: c, title: `${countryName(c)}: 출발 전 ${rule.requiresPreAuth} 신청`, detail: "무비자여도 사전 전자여행허가가 필요합니다." });
    }
    if (rule.validUntil) {
      const lastDay = myEntries.map((e) => e.depart).sort().pop()!;
      if (lastDay > rule.validUntil) {
        checks.push({
          level: "warn",
          country: c,
          title: `${countryName(c)}: 규칙 유효기간(${rule.validUntil})이 여행 날짜보다 먼저 끝남`,
          detail: "현재 규칙이 여행 날짜에도 적용되는지 다시 확인하세요.",
          sources: rule.sources,
        });
      }
    }
    for (const n of rule.notes ?? []) checks.push({ level: "info", country: c, title: `${countryName(c)} 안내`, detail: n, sources: rule.sources });
  }

  /* 4. 러시아–벨라루스 연합 규칙 */
  const ruBy = kb.entries.find((e) => e.id === "ru-by-land")!;
  if (countries.some((c) => zoneOf(c) === "RU-BY") && countries.includes("RU") && countries.includes("BY")) {
    checks.push({
      level: "info",
      title: "러시아·벨라루스 체류일 합산",
      detail: "두 나라 사이를 오가면 체류 기간을 처음 입국한 날부터 함께 계산하는 규칙이 있습니다(비자 소지자 기준). 무비자 입국자에게 어떻게 적용되는지 대사관에 확인하세요.",
      sources: ruBy.sources as SourceRef[],
    });
  }
  for (const l of legs) {
    const pair = [l.fromCountry, l.toCountry].sort().join("-");
    if (pair === "BY-RU" && l.mode !== "flight") {
      checks.push({ level: "warn", title: "러시아–벨라루스 육로 이동", detail: ruBy.summary, sources: ruBy.sources as SourceRef[] });
    }
  }

  /* 5. 별도 발권 환승 국가 */
  for (const t of [...new Set(transitCountries)]) {
    if (t === "KR" || countries.includes(t)) continue;
    const rule = COUNTRY_RULES[t];
    const date = transitDates[t];
    if (t === "CN" && rule) {
      // 중국은 날짜에 따라 다름: 30일 무비자 기한 안이면 입국 가능, 지나면 240시간 무비자 경유 조건
      const inTime = !date || !rule.validUntil || date <= rule.validUntil;
      checks.push({
        level: inTime ? "info" : "warn",
        country: t,
        title: `중국 환승 (별도 발권${date ? ` · ${date}` : ""})`,
        detail: chinaTransitNote(date ?? "0000-00-00"),
        sources: [...(rule.sources ?? []), MOFA_LINK],
      });
      continue;
    }
    const free = isSchengen(t) || rule?.visaFree;
    checks.push({
      level: free ? "info" : "warn",
      country: t,
      title: `${countryName(t)} 환승 (별도 발권)`,
      detail: free
        ? "별도 발권이면 짐을 다시 부치려고 입국해야 할 수 있습니다. 이 나라는 무비자 입국 대상으로 보입니다."
        : "별도 발권이면 이 나라에 입국해야 할 수 있는데, 앱에 확인된 무비자 규칙이 없습니다. 환승 비자 필요 여부를 확인하세요.",
      sources: [MOFA_LINK],
    });
  }

  checks.push({ level: "info", title: "여권 유효기간", detail: "많은 나라가 출국일 기준 3~6개월 이상 남은 여권을 요구합니다. 가장 엄격한 나라 기준으로 확인하세요." });

  const order = { block: 0, warn: 1, ok: 2, info: 3 };
  return checks.sort((a, b) => order[a.level] - order[b.level]);
}
