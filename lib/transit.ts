// 경유지 알아내기와 중국 경유 규칙 (AI 없이 표·규칙으로)
import rules from "@/data/entry-rules.json";
import type { FlightOption } from "@/lib/types";

/** 항공사 → 주 허브 공항 (캐시 가격처럼 경유 공항 정보가 없을 때 '추정'으로만 사용) */
export const CARRIER_HUB: Record<string, { iata: string; city: string; country: string }> = {
  MU: { iata: "PVG", city: "상하이", country: "CN" },
  FM: { iata: "PVG", city: "상하이", country: "CN" },
  HO: { iata: "PVG", city: "상하이", country: "CN" },
  CA: { iata: "PEK", city: "베이징", country: "CN" },
  HU: { iata: "PEK", city: "베이징", country: "CN" },
  CZ: { iata: "CAN", city: "광저우", country: "CN" },
  MF: { iata: "XMN", city: "샤먼", country: "CN" },
  "3U": { iata: "CTU", city: "청두", country: "CN" },
  ZH: { iata: "SZX", city: "선전", country: "CN" },
  CX: { iata: "HKG", city: "홍콩", country: "HK" },
  TK: { iata: "IST", city: "이스탄불", country: "TR" },
  EK: { iata: "DXB", city: "두바이", country: "AE" },
  QR: { iata: "DOH", city: "도하", country: "QA" },
  EY: { iata: "AUH", city: "아부다비", country: "AE" },
  KC: { iata: "ALA", city: "알마티", country: "KZ" },
  HY: { iata: "TAS", city: "타슈켄트", country: "UZ" },
  AY: { iata: "HEL", city: "헬싱키", country: "FI" },
  KL: { iata: "AMS", city: "암스테르담", country: "NL" },
  AF: { iata: "CDG", city: "파리", country: "FR" },
  LH: { iata: "FRA", city: "프랑크푸르트", country: "DE" },
  LO: { iata: "WAW", city: "바르샤바", country: "PL" },
  SU: { iata: "SVO", city: "모스크바", country: "RU" },
};

export const CN_AIRPORTS = new Set(["PVG", "SHA", "PEK", "PKX", "CAN", "XMN", "CTU", "TFU", "SZX", "KMG", "HGH", "NKG", "XIY", "TAO", "SHE", "DLC", "TSN", "CSX", "WUH", "CKG"]);

export interface ViaInfo {
  text: string; // 표에 보일 문구
  china: boolean; // 중국 본토 경유(확인 또는 추정)
  guessed: boolean; // 항공사로 추정했는지
}

export function viaInfo(o: FlightOption): ViaInfo {
  if (!o.stops && !o.via.length) return { text: "직항", china: false, guessed: false };
  if (o.via.length) return { text: o.via.join(", "), china: o.via.some((v) => CN_AIRPORTS.has(v)), guessed: false };
  const hub = o.airlines.map((a) => CARRIER_HUB[a]).find(Boolean);
  if (!hub) return { text: `${o.stops}회`, china: false, guessed: false };
  return { text: `${o.stops}회 · ${hub.city} 경유 추정`, china: hub.country === "CN", guessed: true };
}

const CN = (rules.countries as Record<string, { validUntil?: string }>).CN;

/** 중국 경유 안내 (한국 일반여권, 날짜에 따라 다름) */
export function chinaTransitNote(date: string): string {
  const until = CN?.validUntil ?? "2026-12-31";
  if (date <= until)
    return `중국 경유: 한국 여권은 ${until}까지 30일 무비자라 같은 표든 별도 발권이든 입국해서 짐을 다시 부칠 수 있어요.`;
  return `중국 경유: 한국인 30일 무비자는 ${until}까지로 발표돼 있고 그 뒤 연장은 아직 확인되지 않았어요. 같은 표로 24시간 안에 갈아타면 공항 밖으로 나가지 않는 한 괜찮고, 제3국으로 가는 확정 항공권이 있으면 지정 공항(베이징·상하이·광저우 등)에서 240시간(10일) 무비자 경유가 가능해요. 출발 전 연장 발표를 확인하세요.`;
}
