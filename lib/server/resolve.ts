// 사용자가 입력한 도시 이름 → 좌표·나라·공항이 확정된 Place 로 바꾸는 모듈
// 1) data/cities.json 에서 찾고  2) 없으면 OpenStreetMap Nominatim 으로 검색
// 3) 공항 코드가 없으면 Travelpayouts 공개 공항 목록에서 가까운 공항을 찾습니다.
import "server-only";
import citiesData from "@/data/cities.json";
import { cached, DAY } from "@/lib/cache";
import { env } from "@/lib/env";
import { haversineKm } from "@/lib/geo";
import type { Place } from "@/lib/types";

type CityRow = (typeof citiesData.cities)[number];

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function fromRow(r: CityRow): Place {
  return {
    name: r.name,
    nameEn: r.nameEn,
    country: r.country,
    region: r.region,
    lat: r.lat,
    lng: r.lng,
    airports: r.airports,
    cityCode: (r as { cityCode?: string }).cityCode,
  };
}

export function findLocalCity(input: string, country?: string): Place | null {
  const q = norm(input);
  const row = citiesData.cities.find(
    (c) => (!country || c.country === country) && (norm(c.name) === q || norm(c.nameEn) === q || c.aliases.some((a) => norm(a) === q)),
  );
  return row ? fromRow(row) : null;
}

export const SEOUL: Place = findLocalCity("서울")!;

interface NominatimHit {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: { country_code?: string; state?: string; region?: string; city?: string };
}

async function nominatim(input: string, country?: string): Promise<Place | null> {
  const params: Record<string, string> = { q: input, format: "jsonv2", addressdetails: "1", limit: "1", "accept-language": "en" };
  if (country) params.countrycodes = country.toLowerCase(); // 고른 나라 안에서만 검색
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams(params);
  const res = await fetch(url, {
    headers: { "User-Agent": `RouteAI-student-project (${env.contactEmail})` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as NominatimHit[];
  const h = hits[0];
  if (!h) return null;
  const nameEn = h.name || h.display_name.split(",")[0];
  return {
    name: input.trim(),
    nameEn,
    country: (h.address?.country_code || "").toUpperCase(),
    region: h.address?.state || h.address?.region,
    lat: Number(h.lat),
    lng: Number(h.lon),
    airports: [],
  };
}

interface TpAirport {
  code: string;
  name: string;
  coordinates: { lat: number; lon: number };
  country_code: string;
  city_code: string;
  iata_type: string;
  flightable: boolean;
}

async function airportList(): Promise<TpAirport[]> {
  return cached("tp-airports", DAY, async () => {
    const res = await fetch("https://api.travelpayouts.com/data/en/airports.json", {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    return (await res.json()) as TpAirport[];
  });
}

/** 좌표 근처(기본 150km)의 운항 공항 코드를 가까운 순으로 최대 3개 */
export async function nearbyAirports(lat: number, lng: number, maxKm = 150): Promise<string[]> {
  try {
    const list = await airportList();
    return list
      .filter((a) => a.flightable && a.iata_type === "airport" && a.coordinates)
      .map((a) => ({ code: a.code, d: haversineKm({ lat, lng }, { lat: a.coordinates.lat, lng: a.coordinates.lon }) }))
      .filter((a) => a.d <= maxKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((a) => a.code);
  } catch {
    return [];
  }
}

export async function resolveCity(input: string, country?: string): Promise<Place | null> {
  const local = findLocalCity(input, country);
  if (local) return local;
  return cached(`resolve:${country ?? ""}:${norm(input)}`, DAY, async () => {
    const p = await nominatim(input, country).catch(() => null);
    if (!p || (country && p.country !== country)) return null;
    p.airports = await nearbyAirports(p.lat, p.lng);
    return p;
  });
}
