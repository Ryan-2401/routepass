// 직접 입력한 도시를 브라우저에서 OpenStreetMap(Nominatim)으로 찾기
// (Vercel 서버에서 보내는 요청은 Nominatim이 자주 막아서 브라우저에서 찾습니다. 한국어 이름도 찾을 수 있어요.)
export interface GeoHit {
  nameEn: string;
  lat: number;
  lng: number;
  region?: string;
  display: string;
  viaAi?: string; // AI가 바꿔 준 검색어로 찾았으면 그 검색어
}

async function searchOnce(name: string, country: string): Promise<GeoHit | null> {
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

const HANGUL = /[\uAC00-\uD7A3]/;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1) 입력 그대로 찾고 2) 한국어라서 못 찾으면 AI에게 현지 표기 후보를 받아 다시 찾음 */
export async function geocodeCity(name: string, country: string): Promise<GeoHit | null> {
  const first = await searchOnce(name, country);
  if (first || !HANGUL.test(name)) return first;
  const res = await fetch("/api/romanize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, country }) });
  const { candidates = [] } = (await res.json().catch(() => ({}))) as { candidates?: string[] };
  for (const c of candidates) {
    await wait(1100); // Nominatim 이용 정책: 초당 1회
    const hit = await searchOnce(c, country);
    if (hit) return { ...hit, viaAi: c };
  }
  return null;
}
