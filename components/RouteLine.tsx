"use client";
// 상단 노선도: 인천 → 도시들 → 인천. 구간 색은 그 구간에서 가장 좋은 검증 상태를 따릅니다.
import { fmtKoDate } from "@/lib/dates";
import type { Plan, VerifyResult, VerifyStatus } from "@/lib/types";
import { MODE_KO } from "./bits";

const RANK: Record<VerifyStatus, number> = { operating: 0, conditional: 1, changed: 2, unknown: 3, suspended: 4 };

export function legStatus(plan: Plan, legIndex: number, verify: Record<string, VerifyResult>, hasFlights: boolean): VerifyStatus | "flight" {
  const leg = plan.legs[legIndex];
  const ground = leg.candidates.filter((c) => c.mode !== "flight");
  if (!ground.length) return "flight";
  const sts = ground.map((c) => verify[c.id]?.status).filter(Boolean) as VerifyStatus[];
  if (!sts.length) return hasFlights ? "flight" : "unknown";
  return sts.sort((a, b) => RANK[a] - RANK[b])[0];
}

export default function RouteLine({ plan, verify, flightLegs }: { plan: Plan; verify: Record<string, VerifyResult>; flightLegs: Set<number> }) {
  return (
    <div className="routeline-wrap" aria-label="여정 노선도">
      <div className="routeline">
        <div className="station home">
          <span className="dot" />
          <span className="name">인천</span>
          <span className="meta">{fmtKoDate(plan.request.startDate)} 출발</span>
        </div>
        {plan.legs.map((leg, i) => {
          const st = legStatus(plan, i, verify, flightLegs.has(i));
          const modes = [...new Set(leg.candidates.map((c) => MODE_KO[c.mode]))].join("·");
          const stay = plan.stays[i];
          return (
            <span key={i} style={{ display: "contents" }}>
              <div className="track" data-status={st === "flight" ? undefined : st}>
                <span className="mode">{modes}</span>
              </div>
              {stay ? (
                <div className="station">
                  <span className="dot" />
                  <span className="name">{stay.place.name}</span>
                  <span className="meta">
                    {stay.nights}박 · {fmtKoDate(stay.arrive).replace(/ \(.\)/, "")}
                  </span>
                </div>
              ) : (
                <div className="station home">
                  <span className="dot" />
                  <span className="name">인천</span>
                  <span className="meta">귀국</span>
                </div>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
