"use client";
import type { PathResult } from "@/lib/pathfind";
import type { Plan } from "@/lib/types";
import { hm, won } from "./bits";

const TITLE = { price: "최저가", time: "최단 시간", balanced: "균형 (1시간 = 15,000원으로 환산)" } as const;

/** 체류비(AI 추정) 합계. 한 도시라도 추정치가 없으면 null */
export function stayCost(plan: Plan): number | null {
  if (plan.stays.some((s) => s.estDailyCostKRW === undefined)) return null;
  return plan.stays.reduce((sum, s) => sum + s.nights * (s.estDailyCostKRW ?? 0), 0);
}

function budgetVerdict(total: number, budget: number, tol: number) {
  if (total > budget + tol) return { cls: "over", text: `예산 범위보다 ${won(total - budget - tol)} 많음` };
  if (total < budget - tol) return { cls: "under", text: `예산 범위보다 ${won(budget - tol - total)} 적게 듦` };
  return { cls: "in", text: "예산 범위 안" };
}

export default function PathCompare({ plan, paths }: { plan: Plan; paths: PathResult[] }) {
  if (!paths.length) return <p className="muted">비교할 수 있는 경로가 아직 없습니다. 항공권 검색과 운행 확인이 끝나면 계산합니다.</p>;
  const name = (i: number) => (i === 0 || i === plan.legs.length ? "인천" : plan.stays[i - 1].place.name);
  const stay = stayCost(plan);
  const { budgetKRW: b, budgetToleranceKRW: t } = plan.request;
  return (
    <>
    <p className="budget-line">
      1인 예산 <b>{won(b)}</b> ± {won(t)} (허용 {won(b - t)} ~ {won(b + t)}) · 체류비(숙박·식사·입장료) AI 추정{" "}
      <b>{stay === null ? "없음" : won(stay)}</b>
      {stay !== null ? (
        <span className="muted small">
          {" "}
          ({plan.stays.map((s) => `${s.place.name} ${s.nights}박 × ${won(s.estDailyCostKRW ?? 0)}`).join(", ")})
        </span>
      ) : null}
    </p>
    <div className="paths">
      {paths.map((p) => (
        <article className="path" key={p.objective} data-obj={p.objective}>
          <h4>{TITLE[p.objective]}</h4>
          <p className="total">{won(p.totalKRW)}</p>
          <div className="dur">이동비 · 이동 시간 합계 {hm(p.totalMin)} · 1인 기준</div>
          {stay !== null ? (
            (() => {
              const v = budgetVerdict(p.totalKRW + stay, b, t);
              return (
                <div className={`verdict ${v.cls}`}>
                  이동비 + 체류비 = <b>{won(p.totalKRW + stay)}</b> · {v.text}
                </div>
              );
            })()
          ) : null}
          <ol>
            {p.edges.map((e) => {
              const fromIdx = e.from.startsWith("N") ? Number(e.from.slice(1)) : null;
              const toIdx = e.to.startsWith("N") ? Number(e.to.slice(1)) : null;
              const fromName = fromIdx !== null ? name(fromIdx) : e.from.split("@")[0];
              const toName = toIdx !== null ? name(toIdx) : e.to.split("@")[0];
              return (
                <li key={e.from + e.to + e.ref}>
                  {fromName} → {toName}: {won(e.priceKRW)}
                  <div className="muted small">
                    {e.label}
                    {e.estimated ? " · 추정/예시 금액" : ""}
                    {e.selfTransfer ? " · 별도 발권" : ""}
                  </div>
                </li>
              );
            })}
          </ol>
          {p.estimatedParts || p.selfTransfers ? (
            <div className="flags">
              {p.estimatedParts ? `추정·예시 금액이 ${p.estimatedParts}구간 포함됨. ` : ""}
              {p.selfTransfers ? `별도 발권 ${p.selfTransfers}회 — 환승 시간을 3시간 이상 두세요.` : ""}
            </div>
          ) : null}
        </article>
      ))}
    </div>
    </>
  );
}
