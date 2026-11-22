// 항공권 검색
// - Travelpayouts(Aviasales) 데이터 API: 무료, 최근 2~7일 사이 다른 사람들이 검색한 "캐시 가격". 넓게 훑을 때 사용.
// - SerpApi(Google Flights 결과): 실시간이지만 무료 월 250회. 사용자가 버튼을 눌렀을 때만 호출.
// - 키가 없고 데모 모드면 "예시 가격"(source: sample)을 만들어 화면과 최저가 알고리즘을 시연합니다.
import "server-only";
import { cached, HOUR } from "@/lib/cache";
import { env } from "@/lib/env";
import type { FlightOption, FlightSearchResult } from "@/lib/types";

export function googleFlightsUrl(from: string, to: string, date: string) {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${date} one way`)}`;
}

/* ---------- Travelpayouts ---------- */
interface TpRow {
  origin: string;
  destination: string;
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline?: string;
  flight_number?: string | number;
  departure_at?: string;
  transfers?: number;
  duration?: number;
  duration_to?: number;
  link?: string;
}

async function travelpayouts(from: string, to: string, date: string): Promise<FlightOption[]> {
  const query = async (departureAt: string) => {
    const url =
      "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?" +
      new URLSearchParams({
        origin: from,
        destination: to,
        departure_at: departureAt,
        one_way: "true",
        direct: "false",
        currency: "krw",
        sorting: "price",
        limit: "10",
        token: env.travelpayoutsToken,
      });
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Travelpayouts 오류 ${res.status}`);
    const data = (await res.json()) as { success?: boolean; data?: TpRow[] };
    return data.data ?? [];
  };
  let rows = await query(date);
  if (!rows.length) rows = (await query(date.slice(0, 7))).filter((r) => r.departure_at && Math.abs(Date.parse(r.departure_at) - Date.parse(date)) < 4 * 86400000);
  const now = new Date().toISOString();
  return rows.map((r, i) => ({
    id: `tp-${from}-${to}-${i}`,
    source: "travelpayouts",
    priceKRW: Math.round(r.price),
    durationMin: r.duration_to ?? r.duration,
    stops: r.transfers ?? 0,
    via: viaFromLink(r.link, r.transfers ?? 0),
    segments: [{ from: r.origin_airport ?? r.origin, to: r.destination_airport ?? r.destination, departAt: r.departure_at, airline: r.airline, flightNumber: r.flight_number ? String(r.flight_number) : undefined }],
    airlines: r.airline ? [r.airline] : [],
    departAt: r.departure_at,
    bookingLink: r.link ? `https://www.aviasales.com${r.link}` : undefined,
    cached: true,
    fetchedAt: now,
  }));
}

/**
 * Aviasales 예약 링크의 t= 값 끝에는 경로 공항 코드가 이어 붙어 있음 (예: ...STNMXPDELPVG_해시).
 * 여기서 출발·도착을 뺀 가운데 공항이 실제 경유지. 형식이 다르면 빈 배열(추정으로 대체).
 */
export function viaFromLink(link: string | undefined, transfers: number): string[] {
  if (!link || !transfers) return [];
  const t = /[?&]t=([^&]*)/.exec(link)?.[1];
  const run = t && /([A-Z]{6,})_/.exec(t)?.[1];
  if (!run || run.length % 3) return [];
  const codes = run.match(/.{3}/g)!;
  const via = codes.slice(1, -1);
  return via.length === transfers ? via : [];
}

/* ---------- SerpApi (Google Flights) ---------- */
interface SerpLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  duration?: number;
  airline?: string;
  flight_number?: string;
}
interface SerpItin {
  flights?: SerpLeg[];
  layovers?: { id?: string; name?: string; duration?: number }[];
  total_duration?: number;
  price?: number;
}

async function serpapi(from: string[], to: string[], date: string): Promise<FlightOption[]> {
  const url =
    "https://serpapi.com/search.json?" +
    new URLSearchParams({
      engine: "google_flights",
      departure_id: from.join(","),
      arrival_id: to.join(","),
      outbound_date: date,
      type: "2",
      currency: "KRW",
      hl: "ko",
      gl: "kr",
      api_key: env.serpApiKey,
    });
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`SerpApi 오류 ${res.status}`);
  const data = (await res.json()) as {
    error?: string;
    best_flights?: SerpItin[];
    other_flights?: SerpItin[];
    search_metadata?: { google_flights_url?: string };
  };
  if (data.error) throw new Error(data.error);
  const link = data.search_metadata?.google_flights_url;
  const now = new Date().toISOString();
  return [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
    .filter((f) => typeof f.price === "number")
    .slice(0, 10)
    .map((f, i) => ({
      id: `serp-${from[0]}-${to[0]}-${i}`,
      source: "serpapi",
      priceKRW: Math.round(f.price!),
      durationMin: f.total_duration,
      stops: Math.max(0, (f.flights?.length ?? 1) - 1),
      via: (f.layovers ?? []).map((l) => l.id ?? l.name ?? "?"),
      segments: (f.flights ?? []).map((s) => ({
        from: s.departure_airport?.id ?? "",
        to: s.arrival_airport?.id ?? "",
        departAt: s.departure_airport?.time,
        arriveAt: s.arrival_airport?.time,
        airline: s.airline,
        flightNumber: s.flight_number,
      })),
      airlines: [...new Set((f.flights ?? []).map((s) => s.airline ?? "").filter(Boolean))],
      departAt: f.flights?.[0]?.departure_airport?.time,
      bookingLink: link,
      cached: false,
      fetchedAt: now,
    }));
}

/* ---------- 예시 가격 (데모) ---------- */
export function sampleOptions(from: string, to: string, distanceKm: number, date: string, allowDirect: boolean): FlightOption[] {
  const base = Math.round((70000 + distanceKm * 85) / 1000) * 1000;
  const now = new Date().toISOString();
  const mk = (i: number, price: number, stops: number, dur: number): FlightOption => ({
    id: `sample-${from}-${to}-${i}`,
    source: "sample",
    priceKRW: price,
    durationMin: dur,
    stops,
    via: [],
    segments: [],
    airlines: ["예시 항공"],
    departAt: `${date} 10:00`,
    cached: true,
    fetchedAt: now,
  });
  const dur = Math.round(distanceKm / 12 + 60);
  const oneStop = mk(1, Math.round((base * 0.82) / 1000) * 1000, 1, dur + 240);
  // 인천 노선표에서 직항이 운휴/없음이면 예시에도 직항을 만들지 않음
  return allowDirect ? [mk(0, base, 0, dur), oneStop] : [oneStop, mk(2, Math.round((base * 0.95) / 1000) * 1000, 2, dur + 420)];
}

/* ---------- 진입점 ---------- */
export async function searchFlights(params: {
  from: string[];
  to: string[];
  fromCode?: string; // 도시 코드 (Travelpayouts용)
  toCode?: string;
  date: string;
  realtime: boolean;
  demo: boolean;
  distanceKm: number;
  allowDirect: boolean; // 데모 예시 가격에서 직항을 보여줄지 (인천 노선표 기준)
}): Promise<FlightSearchResult> {
  const { from, to, date } = params;
  const tpFrom = params.fromCode ?? from[0];
  const tpTo = params.toCode ?? to[0];
  const result: FlightSearchResult = { from, to, date, options: [], sourcesTried: [], searchUrl: googleFlightsUrl(from[0], to[0], date) };

  if (!from.length || !to.length) {
    result.sourcesTried.push({ source: "none", ok: false, message: "공항 코드를 찾지 못했습니다." });
    return result;
  }

  if (env.travelpayoutsToken) {
    try {
      const opts = await cached(`tp:${tpFrom}:${tpTo}:${date}`, 6 * HOUR, () => travelpayouts(tpFrom, tpTo, date));
      result.options.push(...opts);
      result.sourcesTried.push({ source: "travelpayouts", ok: true, message: `${opts.length}건 (캐시 가격)` });
    } catch (e) {
      result.sourcesTried.push({ source: "travelpayouts", ok: false, message: (e as Error).message });
    }
  }

  if (params.realtime) {
    if (env.serpApiKey) {
      try {
        const opts = await cached(`serp:${from.join(",")}:${to.join(",")}:${date}`, 12 * HOUR, () => serpapi(from, to, date));
        result.options.push(...opts);
        result.sourcesTried.push({ source: "serpapi", ok: true, message: `${opts.length}건 (실시간)` });
      } catch (e) {
        result.sourcesTried.push({ source: "serpapi", ok: false, message: (e as Error).message });
      }
    } else {
      result.sourcesTried.push({ source: "serpapi", ok: false, message: "SERPAPI_KEY가 없습니다." });
    }
  }

  if (!env.travelpayoutsToken && !env.serpApiKey && params.demo) {
    result.options.push(...sampleOptions(from[0], to[0], params.distanceKm, date, params.allowDirect));
    result.sourcesTried.push({ source: "sample", ok: true, message: "예시 가격" });
  }

  result.options.sort((a, b) => a.priceKRW - b.priceKRW);
  return result;
}
