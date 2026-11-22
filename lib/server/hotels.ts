// 숙소 후보: SerpApi의 Google Hotels 결과 (실제 1박 가격·등급·평점·위치)
// 무료 월 250회를 쓰므로 사용자가 '숙소' 탭을 열었을 때만, 도시마다 한 번 검색하고 12시간 캐시합니다.
// 키가 없거나 실패하면 빈 목록을 돌려주고, 브라우저가 OpenStreetMap 숙소(가격 없음)로 대신 채웁니다.
import "server-only";
import { cached, HOUR } from "@/lib/cache";
import { env } from "@/lib/env";
import type { LodgingClass, PlaceOption } from "@/lib/types";

interface SerpHotel {
  type?: string;
  name?: string;
  link?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rate_per_night?: { extracted_lowest?: number; lowest?: string };
  extracted_hotel_class?: number;
  hotel_class?: string;
  overall_rating?: number;
  reviews?: number;
  check_in_time?: string;
  check_out_time?: string;
  amenities?: string[];
  property_token?: string;
}

const CLASS_PARAM: Record<LodgingClass, string | undefined> = { any: undefined, hostel: "2", "3": "3", "4": "4", "5": "5" };

export function googleHotelsUrl(city: string, checkIn: string, checkOut: string) {
  return `https://www.google.com/travel/hotels/${encodeURIComponent(city)}?q=${encodeURIComponent(`${city} hotels`)}&checkin=${checkIn}&checkout=${checkOut}`;
}

export async function searchHotels(p: {
  cityEn: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  lodgingClass: LodgingClass;
}): Promise<{ options: PlaceOption[]; message: string }> {
  if (!env.serpApiKey) return { options: [], message: "SERPAPI_KEY가 없어 실시간 숙소 가격을 가져오지 못했습니다." };
  const key = `hotels:${p.cityEn}:${p.checkIn}:${p.checkOut}:${p.adults}:${p.lodgingClass}`;
  return cached(key, 12 * HOUR, async () => {
    const params: Record<string, string> = {
      engine: "google_hotels",
      q: `${p.cityEn} hotels`,
      check_in_date: p.checkIn,
      check_out_date: p.checkOut,
      adults: String(p.adults),
      currency: "KRW",
      gl: "kr",
      hl: "ko",
      api_key: env.serpApiKey,
    };
    const cls = CLASS_PARAM[p.lodgingClass];
    if (cls) params.hotel_class = cls;
    if (p.lodgingClass === "hostel") params.q = `${p.cityEn} hostel`;
    const res = await fetch("https://serpapi.com/search.json?" + new URLSearchParams(params), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`SerpApi 오류 ${res.status}`);
    const data = (await res.json()) as { error?: string; properties?: SerpHotel[] };
    if (data.error) throw new Error(data.error);
    const options: PlaceOption[] = (data.properties ?? [])
      .filter((h) => h.name && h.gps_coordinates?.latitude !== undefined && h.gps_coordinates?.longitude !== undefined)
      .slice(0, 15)
      .map((h, i) => {
        const lat = h.gps_coordinates!.latitude!;
        const lng = h.gps_coordinates!.longitude!;
        return {
          id: `hotel-g-${i}-${(h.property_token ?? h.name!).slice(0, 24)}`,
          kind: "hotel",
          name: h.name!,
          lat,
          lng,
          priceKRW: h.rate_per_night?.extracted_lowest,
          stars: h.extracted_hotel_class,
          rating: h.overall_rating,
          reviews: h.reviews,
          hoursText: h.check_in_time ? `체크인 ${h.check_in_time} · 체크아웃 ${h.check_out_time ?? "-"}` : undefined,
          link: h.link,
          mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
          source: "google-hotels",
          reason: h.amenities?.slice(0, 4).join(", "),
        } satisfies PlaceOption;
      });
    return { options, message: `Google 호텔 검색 결과 ${options.length}곳 (검색 시점 가격)` };
  });
}
