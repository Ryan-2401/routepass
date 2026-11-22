// 브라우저에서 OpenStreetMap(Nominatim)으로 숙소·명소·식당 위치 찾기
// Nominatim 이용 정책(초당 1회)을 지키기 위해 queue()로 순서대로 요청합니다.
import type { PlaceOption } from "@/lib/types";

let last = 0;
async function queue<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, last + 1100 - Date.now());
  last = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return fn();
}

interface NomHit {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  type?: string;
  category?: string;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
}

function viewbox(lat: number, lng: number, dLat: number) {
  const dLng = dLat / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  return `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
}

async function search(params: Record<string, string>): Promise<NomHit[]> {
  return queue(async () => {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", extratags: "1", namedetails: "1", "accept-language": "en", ...params }),
      { signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) throw new Error(`지도 검색 오류 ${res.status}`);
    return (await res.json()) as NomHit[];
  });
}

const label = (h: NomHit) => {
  const ko = h.namedetails?.["name:ko"];
  const name = h.name || h.display_name.split(",")[0];
  return ko && ko !== name ? `${name} (${ko})` : name;
};

/** 실시간 가격이 없을 때 쓰는 숙소 목록 (지도에 등록된 호텔·호스텔, 가격 정보 없음) */
export async function osmHotels(lat: number, lng: number, wantHostel: boolean): Promise<PlaceOption[]> {
  const hits = await search({ q: wantHostel ? "hostel" : "hotel", viewbox: viewbox(lat, lng, 0.03), bounded: "1", limit: "30" });
  return hits
    .filter((h) => h.name)
    .map((h) => {
      const stars = Number(h.extratags?.stars);
      return {
        id: `hotel-o-${h.osm_type}${h.osm_id}`,
        kind: "hotel" as const,
        name: label(h),
        lat: Number(h.lat),
        lng: Number(h.lon),
        stars: Number.isFinite(stars) && stars > 0 ? stars : undefined,
        link: h.extratags?.website,
        mapUrl: `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}`,
        source: "osm" as const,
      };
    });
}

/** 도시 근처(약 ±25km)에서 이름으로 장소 찾기 — 명소·스페셜 픽 위치 확인용 */
export async function findInCity(name: string, lat: number, lng: number): Promise<{ lat: number; lng: number; mapUrl: string; openingHours?: string; display: string } | null> {
  const hits = await search({ q: name, viewbox: viewbox(lat, lng, 0.25), bounded: "1", limit: "1" });
  const h = hits[0];
  if (!h) return null;
  return {
    lat: Number(h.lat),
    lng: Number(h.lon),
    mapUrl: `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}`,
    openingHours: h.extratags?.opening_hours,
    display: h.display_name,
  };
}
