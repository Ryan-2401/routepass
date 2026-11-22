// 체류비 계산 (숙소 + 식비 + 입장료·시내교통), 1인 기준
import type { Plan, PlaceOption } from "@/lib/types";

export interface Selection {
  hotel?: PlaceOption;
  picks: PlaceOption[];
}

export interface StayCost {
  total: number;
  lodging: number;
  food: number;
  other: number;
  realHotels: number; // 실제 가격으로 계산한 도시 수
  estimatedHotels: number; // AI 추정으로 계산한 도시 수
  missingHotels: number; // 숙소비를 알 수 없는 도시 수
}

/** 체류비 = 숙소(고른 숙소 실제 가격, 없으면 AI 추정) + 식비(1끼 상한 × 하루 2끼) + 입장료·시내교통(AI 추정). 1인 기준 */
export function stayCost(plan: Plan, selections: Record<number, Selection>): StayCost {
  const r = { total: 0, lodging: 0, food: 0, other: 0, realHotels: 0, estimatedHotels: 0, missingHotels: 0 };
  const people = Math.max(1, plan.request.travelers);
  plan.stays.forEach((s, i) => {
    const hotel = selections[i]?.hotel;
    if (hotel?.priceKRW) {
      r.lodging += (hotel.priceKRW * s.nights) / people; // 방 하나를 함께 쓴다고 보고 1인 몫
      r.realHotels++;
    } else if (s.estLodgingPerNightKRW !== undefined) {
      r.lodging += s.estLodgingPerNightKRW * s.nights;
      r.estimatedHotels++;
    } else r.missingHotels++;
    r.food += plan.request.mealBudgetKRW * 2 * s.nights;
    r.other += (s.estOtherPerDayKRW ?? 0) * s.nights;
  });
  r.total = r.lodging + r.food + r.other;
  return r;
}

