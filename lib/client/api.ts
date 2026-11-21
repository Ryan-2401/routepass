// 브라우저에서 서버 API를 부르는 함수들
import type { EntryCheck, FlightSearchResult, Leg, Place, Plan, Restaurant, TripRequest, VerifyResult } from "@/lib/types";

export class ApiError extends Error {
  constructor(message: string, public kind?: string) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("서버에 연결하지 못했습니다. 개발 서버(npm run dev)가 켜져 있는지 확인하세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, data.kind);
  return data as T;
}

export type PlanResponse = Plan & { hubSuggestions: Record<number, string[]> };

export const api = {
  plan: (req: TripRequest) => post<PlanResponse>("/api/plan", req),
  verify: (leg: Leg, candidateId: string) => post<VerifyResult>("/api/verify", { leg, candidateId }),
  flights: (p: { from: Place; to: Place; date: string; realtime: boolean; demo: boolean; hub?: string; part?: "a" | "b" }) =>
    post<FlightSearchResult>("/api/flights", p),
  entry: (p: { stays: { name: string; country: string; region?: string; arrive: string; depart: string }[]; legs: { fromCountry: string; toCountry: string; mode: string }[]; transitCountries: string[] }) =>
    post<{ checks: EntryCheck[] }>("/api/entry", p),
  places: (p: { lat: number; lng: number; country: string; cityName: string; foodThemes: string[]; count: number; pool?: Restaurant[] }) =>
    post<{ picks: Restaurant[]; poolSize: number; pickedBy: "ai" | "rule" }>("/api/places", p),
  status: async () => (await fetch("/api/status")).json() as Promise<Record<string, boolean | string>>,
};

/** 동시에 n개까지만 실행 (무료 API 속도 제한 보호) */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}
