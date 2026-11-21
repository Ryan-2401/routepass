// OpenStreetMap에서 "실제로 등록된" 식당 목록 가져오기 (브라우저·서버 공용)
// 1순위 Nominatim(빠름, 1초 1회 제한) → 2순위 Overpass 미러(느리지만 더 많음)
import type { Restaurant } from "@/lib/types";

interface NomHit {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  type?: string;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
}

function displayName(name: string, details?: Record<string, string> | null) {
  const ko = details?.["name:ko"];
  const en = details?.["name:en"];
  const extra = ko && ko !== name ? ko : en && en !== name ? en : "";
  return extra ? `${name} (${extra})` : name;
}

export async function nominatimRestaurants(lat: number, lng: number, headers: Record<string, string> = {}): Promise<Restaurant[]> {
  const d = 0.012; // 위도 약 1.3km
  const dl = d / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      amenity: "restaurant",
      viewbox: `${lng - dl},${lat + d},${lng + dl},${lat - d}`,
      bounded: "1",
      format: "jsonv2",
      limit: "40",
      extratags: "1",
      namedetails: "1",
      "accept-language": "en",
    });
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hits = (await res.json()) as NomHit[];
  return hits
    .filter((h) => h.name && (h.type === "restaurant" || h.category === "amenity"))
    .map((h) => ({
      osmId: `${h.osm_type}/${h.osm_id}`,
      name: displayName(h.name!, h.namedetails),
      cuisine: h.extratags?.cuisine?.replace(/;/g, ", "),
      lat: Number(h.lat),
      lng: Number(h.lon),
      openingHours: h.extratags?.opening_hours,
      website: h.extratags?.website ?? h.extratags?.["contact:website"],
      osmUrl: `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}`,
    }));
}

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"];

export async function overpassRestaurants(lat: number, lng: number, headers: Record<string, string> = {}): Promise<Restaurant[]> {
  const q = `[out:json][timeout:20];nwr["amenity"="restaurant"]["name"](around:1200,${lat},${lng});out center 60;`;
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const data = (await res.json()) as { elements: OsmEl[] };
      return data.elements
        .map((e): Restaurant | null => {
          const t = e.tags ?? {};
          const la = e.lat ?? e.center?.lat;
          const lo = e.lon ?? e.center?.lon;
          if (la === undefined || lo === undefined || !t.name) return null;
          return {
            osmId: `${e.type}/${e.id}`,
            name: displayName(t.name, t),
            cuisine: t.cuisine?.replace(/;/g, ", "),
            lat: la,
            lng: lo,
            openingHours: t.opening_hours,
            website: t.website ?? t["contact:website"],
            osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
          };
        })
        .filter((x): x is Restaurant => x !== null);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass 조회 실패");
}

/** Nominatim을 먼저, 실패하거나 비면 Overpass */
export async function fetchRestaurants(lat: number, lng: number, headers: Record<string, string> = {}): Promise<Restaurant[]> {
  try {
    const r = await nominatimRestaurants(lat, lng, headers);
    if (r.length) return r;
  } catch {
    /* 다음 방법으로 */
  }
  return overpassRestaurants(lat, lng, headers);
}
