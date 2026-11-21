// 직접 입력한 도시를 브라우저에서 OpenStreetMap(Nominatim)으로 찾기
// (Vercel 서버에서 보내는 요청은 Nominatim이 자주 막아서 브라우저에서 찾습니다. 한국어 이름도 찾을 수 있어요.)
export interface GeoHit {
  nameEn: string;
  lat: number;
  lng: number;
  region?: string;
  display: string;
}

export async function geocodeCity(name: string, country: string): Promise<GeoHit | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q: name, countrycodes: country.toLowerCase(), format: "jsonv2", addressdetails: "1", limit: "1", "accept-language": "en" });
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const hit = ((await res.json()) as { lat: string; lon: string; name?: string; display_name: string; address?: { state?: string; region?: string } }[])[0];
  if (!hit) return null;
  return {
    nameEn: hit.name || hit.display_name.split(",")[0],
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    region: hit.address?.state || hit.address?.region,
    display: hit.display_name,
  };
}
