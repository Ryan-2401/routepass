// 인천 출발 노선표(data/incheon-routes.json)를 다루는 순수 함수들
import routesData from "@/data/incheon-routes.json";
import { haversineKm } from "@/lib/geo";
import type { GatewayInfo, Place } from "@/lib/types";

export interface RouteRow {
  city: string;
  country: string;
  iata: string;
  region: string;
  lat: number;
  lng: number;
  status: "operating" | "suspended";
  hub?: boolean;
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

/** 환승 허브 후보 (노선표에서 hub 표시된 공항) — AI가 검색할 허브를 고를 때 후보로 제공 */
export function hubCandidates(): RouteRow[] {
  return operatingRoutes().filter((r) => r.hub);
}
