// 앱 전체에서 함께 쓰는 데이터 모양(타입) 정의

export type ISO2 = string;

/** 좌표가 확정된 도시 */
export interface Place {
  name: string; // 화면에 보이는 이름 (한국어 우선)
  nameEn: string;
  country: ISO2;
  region?: string; // 주·지역 (여행경보 지역 판정용)
  lat: number;
  lng: number;
  airports: string[]; // 공항 IATA 코드들
  cityCode?: string; // 도시 IATA 코드 (MOW 등)
}

/** 사용자 입력 */
export interface TripRequest {
  cities: { name: string; country?: ISO2; days?: number }[]; // 방문 순서대로 (country: 화면에서 고른 나라)
  startDate: string; // YYYY-MM-DD (인천 출발일)
  totalDays?: number; // 도시별 일수를 비웠을 때 AI가 나눌 전체 일수
  budgetKRW: number; // 1인 총예산 (항공·교통·숙박·식비 포함)
  budgetToleranceKRW: number; // 허용 범위 ±
  interests: string[];
  travelers: number;
}

export type TransportMode = "flight" | "train" | "bus" | "ferry" | "car" | "walk";

/** AI가 제안한 구간 이동 수단 (아직 검증 전) */
export interface TransportCandidate {
  id: string;
  mode: TransportMode;
  description: string; // 예: "탈린 버스터미널 → 나르바 → 도보 국경 통과 → 상트"
  operatorHint?: string; // 예: "Lux Express"
  estDurationMin?: number; // AI 추정
  estPriceKRW?: number; // AI 추정
  borderCrossing?: boolean;
  notes?: string;
}

export interface Leg {
  index: number;
  from: Place;
  to: Place;
  date: string; // 이동일
  distanceKm: number;
  candidates: TransportCandidate[];
}

export interface DayItem {
  slot: "오전" | "점심" | "오후" | "저녁" | "밤";
  title: string;
  kind: "sight" | "food" | "move" | "rest";
  note?: string;
}

export interface DayPlan {
  date: string;
  theme: string;
  items: DayItem[];
}

export interface CityStay {
  place: Place;
  arrive: string; // 도착일
  depart: string; // 출발일
  nights: number;
  summary: string;
  days: DayPlan[];
  estDailyCostKRW?: number; // AI 추정: 1인 하루 숙박·식사·입장료
}

export interface GatewayInfo {
  city: string;
  hasDirect: boolean; // 인천 직항(운항 중)이 있는지
  suspendedDirect: boolean; // 노선표에 있지만 운휴인지
  nearest: { city: string; iata: string; country: ISO2; distanceKm: number; hub?: boolean }[];
}

export interface Plan {
  mode: "live" | "demo";
  request: TripRequest;
  origin: Place; // 서울(인천)
  stays: CityStay[];
  legs: Leg[]; // 인천→첫 도시, …, 마지막 도시→인천
  gateways: GatewayInfo[];
  tips: string[];
  generatedBy: string; // 모델 이름 또는 "demo"
  validation: string[]; // AI 결과를 코드가 고친/거부한 기록
}

/* ---------- 교통편 검증 ---------- */

export type VerifyStatus = "operating" | "conditional" | "changed" | "suspended" | "unknown";

export interface SourceRef {
  title: string;
  url: string;
  date?: string;
}

export interface VerifyResult {
  legIndex: number;
  candidateId: string;
  status: VerifyStatus;
  summary: string;
  sources: SourceRef[];
  method: "knowledge-base" | "search+ai" | "none";
  checkedAt: string;
  rejectedUrls?: string[]; // AI가 검색 결과에 없는 URL을 댄 경우 (환각 차단 기록)
}

/* ---------- 항공 ---------- */

export interface FlightSegment {
  from: string;
  to: string;
  departAt?: string;
  arriveAt?: string;
  airline?: string;
  flightNumber?: string;
}

export interface FlightOption {
  id: string;
  source: "serpapi" | "travelpayouts" | "sample";
  priceKRW: number;
  durationMin?: number;
  stops: number;
  via: string[]; // 환승 공항
  segments: FlightSegment[];
  airlines: string[];
  departAt?: string;
  bookingLink?: string;
  cached: boolean; // 캐시 가격이면 true (실시간 아님)
  fetchedAt: string;
}

export interface FlightSearchResult {
  from: string[];
  to: string[];
  date: string;
  options: FlightOption[];
  sourcesTried: { source: string; ok: boolean; message?: string }[];
  searchUrl: string; // 사용자가 직접 확인할 수 있는 Google Flights 링크
}

/* ---------- 출입국 ---------- */

export type CheckLevel = "block" | "warn" | "info" | "ok";

export interface EntryCheck {
  level: CheckLevel;
  country?: ISO2;
  title: string;
  detail: string;
  sources?: SourceRef[];
}

/* ---------- 식당 ---------- */

export interface Restaurant {
  osmId: string;
  name: string;
  cuisine?: string;
  lat: number;
  lng: number;
  openingHours?: string;
  website?: string;
  osmUrl: string;
  reason?: string;
}
