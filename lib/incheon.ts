// 인천 출발 노선표(data/incheon-routes.json)를 다루는 순수 함수들
import routesData from "@/data/incheon-routes.json";
import { haversineKm } from "@/lib/geo";
import type { GatewayInfo, Leg, Place } from "@/lib/types";

export interface RouteRow {
  city: string;
  country: string;
  iata: string;
  region: string;
  lat: number;
  lng: number;
  status: "operating" | "suspended";
  hub?: boolean;
  hubGroup?: "CN"; // 중국 허브는 따로 1곳만 고름
  note?: string;
}

export const ROUTES = routesData.routes as RouteRow[];

export function operatingRoutes(): RouteRow[] {
  return ROUTES.filter((r) => r.status === "operating");
}

/** 이 도시의 공항 중 인천 노선표에 있는 행 */
export function routeRowsFor(place: Place): RouteRow[] {
  return ROUTES.filter((r) => place.airports.includes(r.iata));
}

/** 직항 가능 여부와 가까운 대체 관문 공항 */
export function gatewayInfo(place: Place, limit = 3): GatewayInfo {
  const rows = routeRowsFor(place);
  const hasDirect = rows.some((r) => r.status === "operating");
  const suspendedDirect = rows.length > 0 && !hasDirect;
  const nearest = operatingRoutes()
    .filter((r) => r.country !== "KR" && !place.airports.includes(r.iata))
    .map((r) => ({
      city: r.city,
      iata: r.iata,
      country: r.country,
      hub: r.hub,
      distanceKm: haversineKm(place, r),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
  return { city: place.name, hasDirect, suspendedDirect, nearest };
}

/** 환승 허브 후보 (노선표에서 hub 표시되고 운항 중인 공항) */
export function hubCandidates(): RouteRow[] {
  return operatingRoutes().filter((r) => r.hub);
}

/**
 * 별도 발권 환승지 고르기 (AI 없이 거리 계산):
 * 유럽 도시 → 허브 → 인천이 직선 경로보다 얼마나 돌아가는지(우회 거리)가 작은 허브부터 n곳.
 * 인천이 끼지 않은 구간이나, 도시 바로 옆(150km 안) 허브는 제외.
 */
export function pickHubs(leg: Leg, n = 2): string[] {
  const kr = leg.from.country === "KR" ? leg.from : leg.to.country === "KR" ? leg.to : null;
  if (!kr) return [];
  const eu = kr === leg.from ? leg.to : leg.from;
  const straight = haversineKm(eu, kr);
  const ranked = hubCandidates()
    .filter((h) => !eu.airports.includes(h.iata) && haversineKm(eu, h) > 150)
    .map((h) => ({ iata: h.iata, cn: h.hubGroup === "CN", detour: haversineKm(eu, h) + haversineKm(h, kr) - straight }))
    .sort((a, b) => a.detour - b.detour);
  // 유럽·중동·중앙아시아 허브 n곳 + 중국 허브 1곳 (중국 항공사 경유가 싼 경우가 많아서 따로 확인)
  return [...ranked.filter((h) => !h.cn).slice(0, n), ...ranked.filter((h) => h.cn).slice(0, 1)].map((h) => h.iata);
}
