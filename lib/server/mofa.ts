// 외교부 여행경보 실시간 조회 (공공데이터포털 "외교부_국가∙지역별 여행경보제도", TravelWarningServiceV3)
// 응답 필드 이름이 문서에 자세히 나와 있지 않아, 응답 안에서 "N단계" 텍스트를 찾는 방식으로 읽습니다.
// 처음 키를 받으면 scripts/mofa-probe.ts 로 실제 응답을 확인하고 필요하면 이 파일을 고치세요.
import "server-only";
import { cached, HOUR } from "@/lib/cache";
import { env } from "@/lib/env";
import type { EntryCheck } from "@/lib/types";
import { countryName } from "@/lib/countries";

const ENDPOINT = "https://apis.data.go.kr/1262000/TravelWarningServiceV3/getTravelWarningListV3";

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

export async function fetchTravelWarning(iso2: string): Promise<{ level: number | null; texts: string[]; raw: unknown }> {
  return cached(`mofa:${iso2}`, 6 * HOUR, async () => {
    const url = `${ENDPOINT}?serviceKey=${encodeURIComponent(env.dataGoKrKey)}&returnType=JSON&numOfRows=20&pageNo=1&${encodeURIComponent("cond[iso_code::EQ]")}=${iso2}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`외교부 API 오류 ${res.status}`);
    const raw = await res.json().catch(async () => ({ text: await res.text() }));
    const texts = collectStrings(raw).filter((s) => /[1-4]\s*단계|여행(유의|자제|금지)|출국권고/.test(s));
    const levels = texts.flatMap((t) => [...t.matchAll(/([1-4])\s*단계/g)].map((m) => Number(m[1])));
    return { level: levels.length ? Math.max(...levels) : null, texts: [...new Set(texts)].slice(0, 4), raw };
  });
}

export async function mofaChecks(countries: string[]): Promise<EntryCheck[]> {
  if (!env.dataGoKrKey) return [];
  const out: EntryCheck[] = [];
  for (const c of countries.filter((x) => x !== "KR")) {
    try {
      const w = await fetchTravelWarning(c);
      if (w.level === null) {
        out.push({ level: "info", country: c, title: `${countryName(c)}: 외교부 여행경보 없음`, detail: "실시간 조회 결과 발령된 경보가 없습니다.", sources: [{ title: "외교부 해외안전여행", url: "https://www.0404.go.kr" }] });
        continue;
      }
      // "여행금지(일부)"처럼 일부 지역에만 걸린 4단계는 나라 전체를 막지 않고 경고로 표시
      const partial = w.texts.some((t) => /일부/.test(t));
      const level = w.level >= 4 && !partial ? "block" : w.level >= 2 ? "warn" : "info";
      out.push({
        level,
        country: c,
        title:
          w.level >= 4 && partial
            ? `${countryName(c)}: 일부 지역 여행금지(4단계) 포함 (외교부 실시간)`
            : `${countryName(c)}: 외교부 여행경보 최고 ${w.level}단계 (실시간)`,
        detail: `${w.texts.join(" / ").slice(0, 400)} — 방문 도시가 이 지역에 해당하는지 확인하세요. 지역마다 단계가 다릅니다.`,
        sources: [{ title: "외교부 해외안전여행", url: "https://www.0404.go.kr" }],
      });
    } catch (e) {
      out.push({ level: "info", country: c, title: `${countryName(c)}: 외교부 실시간 조회 실패`, detail: (e as Error).message });
    }
  }
  return out;
}
