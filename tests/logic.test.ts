// 핵심 규칙 테스트: npm test
import { describe, expect, it } from "vitest";
import { maxDaysInWindow, runEntryChecks } from "@/lib/entry";
import { stayCost } from "@/lib/budget";
import { chinaTransitNote, viaInfo } from "@/lib/transit";
import { gatewayInfo, pickHubs } from "@/lib/incheon";
import { isOpenAt, moveText } from "@/lib/server/picks";
import { bestPaths, buildGraph, flightKey } from "@/lib/pathfind";
import { extractJson } from "@/lib/server/gemini";
import { allocateNights, banBlock, polishDays, ruleCandidates } from "@/lib/server/planner";
import { findLocalCity } from "@/lib/server/resolve";
import { matchKnowledgeBase } from "@/lib/server/verify";
import type { FlightOption, Leg, TransportCandidate } from "@/lib/types";

const city = (n: string) => findLocalCity(n)!;
const cand = (id: string, mode: TransportCandidate["mode"], description: string, extra: Partial<TransportCandidate> = {}): TransportCandidate => ({ id, mode, description, ...extra });
const leg = (index: number, a: string, b: string, candidates: TransportCandidate[]): Leg => ({ index, from: city(a), to: city(b), date: "2027-01-10", distanceKm: 500, candidates });
const fo = (id: string, price: number, dur = 600): FlightOption => ({ id, source: "travelpayouts", priceKRW: price, durationMin: dur, stops: 0, via: [], segments: [], airlines: ["X"], cached: true, fetchedAt: "" });

describe("체류일 배분", () => {
  it("입력한 박 수를 그대로 쓴다", () => {
    expect(allocateNights({ cities: [{ name: "a", days: 3 }, { name: "b", days: 2 }], startDate: "2027-01-01", budgetKRW: 3000000, budgetToleranceKRW: 300000, lodgingClass: "any", mealBudgetKRW: 40000, interests: [], travelers: 1 })).toEqual([3, 2]);
  });
  it("비운 도시는 전체 일수에서 나눈다", () => {
    expect(allocateNights({ cities: [{ name: "a", days: 4 }, { name: "b" }, { name: "c" }], totalDays: 9, startDate: "2027-01-01", budgetKRW: 3000000, budgetToleranceKRW: 300000, lodgingClass: "any", mealBudgetKRW: 40000, interests: [], travelers: 1 })).toEqual([4, 3, 2]);
  });
});

describe("여행금지", () => {
  it("우크라이나 도시는 일정 생성을 막는다", () => {
    expect(banBlock({ name: "키이우", nameEn: "Kyiv", country: "UA", lat: 50.45, lng: 30.52, airports: [] })).toMatch(/여행금지/);
  });
  it("쿠르스크주는 막고, 민스크는 통과", () => {
    expect(banBlock(city("쿠르스크"))).toMatch(/여행금지 지역/);
    expect(banBlock(city("민스크"))).toBeNull();
  });
});

describe("나라를 고른 도시 찾기", () => {
  it("고른 나라와 맞을 때만 찾는다", () => {
    expect(findLocalCity("파리", "FR")?.nameEn).toBe("Paris");
    expect(findLocalCity("파리", "IT")).toBeNull();
    expect(findLocalCity("로마", "IT")?.airports).toContain("FCO");
  });
});

describe("유럽 도시 목록", () => {
  it("선택 목록의 모든 도시가 데이터에 있고 나라가 맞다", async () => {
    const menu = (await import("@/data/city-menu.json")).menu as Record<string, string[]>;
    for (const [country, names] of Object.entries(menu)) {
      for (const n of names) expect(findLocalCity(n, country), `${country} ${n}`).not.toBeNull();
    }
  });
  it("유럽 밖 도시는 목록에 없다", async () => {
    const menu = (await import("@/data/city-menu.json")).menu as Record<string, string[]>;
    expect(Object.keys(menu)).not.toContain("JP");
    expect(Object.keys(menu)).not.toContain("US");
  });
});

describe("인천 노선표", () => {
  it("모스크바는 직항 운휴, 헬싱키는 운항", () => {
    const m = gatewayInfo(city("모스크바"));
    expect(m.hasDirect).toBe(false);
    expect(m.suspendedDirect).toBe(true);
    expect(m.nearest[0].iata).toBe("HEL");
    expect(gatewayInfo(city("헬싱키")).hasDirect).toBe(true);
  });
});

describe("운행 지식베이스 매칭", () => {
  it("알레그로는 어느 구간에서 나와도 운행 중단", () => {
    const l = leg(2, "상트페테르부르크", "탈린", [cand("a", "train", "알레그로 열차로 헬싱키 경유", { operatorHint: "Allegro (VR)" })]);
    expect(matchKnowledgeBase(l, l.candidates[0])?.status).toBe("suspended");
  });
  it("프스코프 경유 버스는 중단, 나르바 경유 버스는 조건부", () => {
    const l = leg(2, "상트페테르부르크", "탈린", [cand("p", "bus", "프스코프 경유 연결 버스"), cand("n", "bus", "이반고로드 도보 국경 통과 후 나르바", { operatorHint: "Lux Express" })]);
    expect(matchKnowledgeBase(l, l.candidates[0])?.id).toBe("tallinn-pskov-bus");
    expect(matchKnowledgeBase(l, l.candidates[1])?.status).toBe("conditional");
  });
  it("탈린–헬싱키 페리는 지식베이스에 없음", () => {
    const l = leg(3, "탈린", "헬싱키", [cand("f", "ferry", "탈린 항구 → 헬싱키 항구")]);
    expect(matchKnowledgeBase(l, l.candidates[0])).toBeNull();
  });
});

describe("최저가 경로 (다익스트라)", () => {
  const legs = [
    leg(0, "서울", "모스크바", [cand("L0-0", "flight", "환승편")]),
    leg(1, "모스크바", "상트페테르부르크", [cand("L1-0", "train", "고속열차", { estPriceKRW: 90000, estDurationMin: 240 }), cand("L1-1", "train", "야간열차", { estPriceKRW: 60000, estDurationMin: 540 })]),
    leg(2, "상트페테르부르크", "서울", [cand("L2-0", "flight", "귀국")]),
  ];
  const flights = {
    [flightKey(0)]: [fo("d1", 900000, 900)],
    [flightKey(0, "IST", "a")]: [fo("h1", 400000, 700)],
    [flightKey(0, "IST", "b")]: [fo("h2", 300000, 200)],
    [flightKey(2)]: [fo("r1", 800000, 800)],
  };
  it("별도 발권 조합이 더 싸면 최저가 경로로 고른다", () => {
    const paths = bestPaths(buildGraph({ legs, flights, hubs: { 0: ["IST"] }, verify: {} }), legs.length);
    const price = paths.find((p) => p.objective === "price")!;
    expect(price.totalKRW).toBe(400000 + 300000 + 60000 + 800000);
    expect(price.selfTransfers).toBe(1);
  });
  it("운행 중단 수단은 경로에서 뺀다", () => {
    const verify = { "L1-1": { legIndex: 1, candidateId: "L1-1", status: "suspended" as const, summary: "", sources: [], method: "knowledge-base" as const, checkedAt: "" } };
    const paths = bestPaths(buildGraph({ legs, flights, hubs: { 0: ["IST"] }, verify }), legs.length);
    expect(paths.find((p) => p.objective === "price")!.edges.some((e) => e.ref === "L1-1")).toBe(false);
  });
  it("최단 시간은 직항을 고른다", () => {
    const paths = bestPaths(buildGraph({ legs, flights, hubs: { 0: ["IST"] }, verify: {} }), legs.length);
    expect(paths.find((p) => p.objective === "time")!.edges[0].ref).toBe("d1");
  });
});

describe("출입국 규칙", () => {
  const stays = [
    { name: "모스크바", country: "RU", region: "Moscow", arrive: "2027-01-10", depart: "2027-01-13" },
    { name: "상트페테르부르크", country: "RU", region: "Saint Petersburg", arrive: "2027-01-13", depart: "2027-01-16" },
    { name: "탈린", country: "EE", arrive: "2027-01-16", depart: "2027-01-18" },
    { name: "헬싱키", country: "FI", arrive: "2027-01-18", depart: "2027-01-20" },
  ];
  it("쉥겐 체류일은 입국일·출국일 포함 합산", () => {
    const c = runEntryChecks(stays, []);
    expect(c.find((x) => x.title.startsWith("쉥겐"))?.title).toBe("쉥겐 지역 체류 5일 / 90일");
  });
  it("러시아 연속 체류는 하나의 입국으로 계산", () => {
    const c = runEntryChecks(stays, []);
    expect(c.find((x) => x.title.startsWith("러시아 체류"))?.title).toBe("러시아 체류 7일 / 1회 60일");
  });
  it("쉥겐 90일 초과는 불가", () => {
    const long = [{ name: "파리", country: "FR", arrive: "2027-01-01", depart: "2027-04-15" }];
    expect(runEntryChecks(long, []).find((x) => x.title.startsWith("쉥겐"))?.level).toBe("block");
  });
  it("러시아–벨라루스 육로는 경고, 브레스트는 국경 30km 경고", () => {
    const s = [
      { name: "모스크바", country: "RU", region: "Moscow", arrive: "2027-01-10", depart: "2027-01-13" },
      { name: "브레스트", country: "BY", region: "Brest Region", arrive: "2027-01-13", depart: "2027-01-15" },
    ];
    const c = runEntryChecks(s, [{ fromCountry: "RU", toCountry: "BY", mode: "train" }]);
    expect(c.some((x) => x.title === "러시아–벨라루스 육로 이동" && x.level === "warn")).toBe(true);
    expect(c.some((x) => x.title.includes("브레스트") && x.level === "warn")).toBe(true);
    expect(c.some((x) => x.title.includes("벨라루스: 규칙 유효기간"))).toBe(true);
  });
  it("180일 창 계산", () => {
    expect(maxDaysInWindow(["2027-01-01", "2027-01-02", "2027-08-01"], 180)).toBe(2);
  });
});

describe("숙소·식비 예산과 영업시간", () => {
  it("고른 숙소는 실제 가격, 안 고른 도시는 AI 추정, 식비는 1끼 상한 × 2끼", () => {
    const base = { place: city("파리"), arrive: "2027-01-10", depart: "2027-01-12", nights: 2, days: [], estLodgingPerNightKRW: 100000, estOtherPerDayKRW: 20000 };
    const plan = { request: { travelers: 2, mealBudgetKRW: 30000 }, stays: [base, { ...base, place: city("로마") }] } as unknown as Parameters<typeof stayCost>[0];
    const hotel = { id: "h", kind: "hotel", name: "H", lat: 0, lng: 0, priceKRW: 300000, mapUrl: "", source: "google-hotels" } as const;
    const c = stayCost(plan, { 0: { hotel, picks: [] } });
    expect(c.realHotels).toBe(1);
    expect(c.estimatedHotels).toBe(1);
    expect(c.lodging).toBe(300000 + 200000); // 방값 30만×2박÷2명 + 10만×2박
    expect(c.food).toBe(30000 * 2 * 4);
    expect(c.other).toBe(20000 * 4);
  });
  it("영업시간 검사", () => {
    expect(isOpenAt("Mo-Fr 09:00-18:00", "2027-01-11", "10:00")).toBe(true); // 월요일
    expect(isOpenAt("Mo-Fr 09:00-18:00", "2027-01-10", "10:00")).toBe(false); // 일요일
    expect(isOpenAt(undefined, "2027-01-10", "10:00")).toBeNull();
  });
});

describe("일차별 일정 다듬기", () => {
  it("시간순 정렬과 휴무 요일 경고", () => {
    const [d] = polishDays([
      { date: "2027-01-12", theme: "", items: [
        { slot: "오후", time: "14:00", title: "루브르", kind: "sight", closedDays: ["화"] },
        { slot: "오전", time: "9:30", title: "산책", kind: "sight" },
      ] },
    ]); // 2027-01-12는 화요일
    expect(d.items.map((i) => i.title)).toEqual(["산책", "루브르"]);
    expect(d.items[0].time).toBe("09:30");
    expect(d.items[1].warning).toContain("화요일");
    expect(d.items[0].warning).toBeUndefined();
  });
  it("식사 메뉴 옮기기와 식비 상한 경고", () => {
    const [d] = polishDays([{ date: "2027-01-11", theme: "", items: [{ slot: "저녁", title: "비스트로", kind: "food", note: "어니언 수프, 스테이크", costKRW: 80000 }] }], 40000);
    expect(d.items[0].menu).toEqual(["어니언 수프", "스테이크"]);
    expect(d.items[0].warning).toContain("상한");
  });
  it("거리로 이동 방법 추정", () => {
    expect(moveText(0.5, "숙소에서")).toContain("도보");
    expect(moveText(5, "앞 장소에서")).toContain("대중교통");
  });
});

describe("AI가 붐빌 때 대비", () => {
  it("설명이 붙은 JSON도 꺼냄", () => {
    expect(extractJson('여기 결과입니다:\n{"a":1}\n끝')).toEqual({ a: 1 });
  });
  it("거리·국가 규칙 기본 이동 후보", () => {
    const seoul = { ...city("파리"), country: "KR" };
    expect(ruleCandidates({ index: 0, from: seoul, to: city("파리"), date: "", distanceKm: 9000, candidates: [] }).map((c) => c.mode)).toEqual(["flight"]);
    expect(ruleCandidates({ index: 1, from: city("파리"), to: city("런던"), date: "", distanceKm: 340, candidates: [] }).map((c) => c.mode)).toEqual(["train", "bus"]);
    expect(ruleCandidates({ index: 2, from: city("모스크바"), to: city("리가"), date: "", distanceKm: 840, candidates: [] }).map((c) => c.mode)).toEqual(["bus"]);
  });
});

describe("별도 발권 환승지 (코드 계산)", () => {
  it("인천 구간만, 우회가 적은 허브 2곳", () => {
    const seoul = { ...city("파리"), name: "서울", country: "KR", lat: 37.46, lng: 126.44, airports: ["ICN"] };
    const hubs = pickHubs({ index: 0, from: city("런던"), to: seoul, date: "", distanceKm: 8800, candidates: [] });
    expect(hubs).toHaveLength(3); // 일반 허브 2곳 + 중국 허브 1곳
    expect(["PVG", "PEK", "CAN"]).toContain(hubs[2]);
    console.log("런던→서울 허브:", hubs, " 파리→서울:", pickHubs({ index: 0, from: city("파리"), to: seoul, date: "", distanceKm: 0, candidates: [] }));
    expect(pickHubs({ index: 1, from: city("파리"), to: city("로마"), date: "", distanceKm: 1100, candidates: [] })).toEqual([]);
    expect(pickHubs({ index: 0, from: seoul, to: city("파리"), date: "", distanceKm: 0, candidates: [] })).not.toContain("CDG");
  });
});

describe("중국 경유", () => {
  it("경유 공항이 없으면 항공사 허브로 추정", () => {
    expect(viaInfo(fo("a", 1)).text).toBe("직항");
    const mu = { ...fo("b", 1), stops: 1, airlines: ["MU"] };
    expect(viaInfo(mu)).toMatchObject({ china: true, guessed: true });
    expect(viaInfo({ ...mu, via: ["PEK"] })).toMatchObject({ text: "PEK", china: true, guessed: false });
  });
  it("날짜에 따라 30일 무비자 또는 240시간 경유 안내", () => {
    expect(chinaTransitNote("2026-12-20")).toContain("30일 무비자라");
    expect(chinaTransitNote("2027-01-15")).toContain("240시간");
  });
  it("출입국 검사: 2027년 중국 별도 발권 환승은 경고", () => {
    const stays = [{ name: "파리", country: "FR", arrive: "2027-01-10", depart: "2027-01-14" }];
    const c = runEntryChecks(stays, [], ["CN"], { CN: "2027-01-14" }).find((x) => x.country === "CN")!;
    expect(c.level).toBe("warn");
    expect(runEntryChecks(stays, [], ["CN"], { CN: "2026-12-14" }).find((x) => x.country === "CN")!.level).toBe("info");
  });
});
