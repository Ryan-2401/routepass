"use client";
import { countryName } from "@/lib/countries";
import { fmtKoDate } from "@/lib/dates";
import type { CityStay, Restaurant } from "@/lib/types";
import { AiTag } from "./bits";

export interface EatState {
  status: "idle" | "loading" | "done" | "error";
  picks?: Restaurant[];
  pickedBy?: "ai" | "rule";
  poolSize?: number;
  error?: string;
}

export default function CityBlock({ stay, demo, eat, onRetryEat }: { stay: CityStay; demo: boolean; eat?: EatState; onRetryEat: () => void }) {
  return (
    <article className="city" aria-label={stay.place.name}>
      <h4>{stay.place.name}</h4>
      <div className="when">
        {countryName(stay.place.country)} · {fmtKoDate(stay.arrive)} → {fmtKoDate(stay.depart)} · {stay.nights}박
      </div>
      <p className="summary">
        {stay.summary}
        <AiTag demo={demo} />
      </p>
      <div className="days">
        {stay.days.map((d) => (
          <section className="day" key={d.date}>
            <div className="d">{fmtKoDate(d.date)}</div>
            <div className="theme">{d.theme}</div>
            <ul>
              {d.items.map((it, k) => (
                <li key={k} data-kind={it.kind}>
                  <span className="slot">{it.slot}</span>
                  <span className="t">
                    {it.title}
                    {it.note ? <span className="muted small"> — {it.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="eat">
        <h5>
          지도에서 확인된 식당
          {eat?.pickedBy === "ai" ? <AiTag /> : null}
        </h5>
        {!eat || eat.status === "idle" || eat.status === "loading" ? (
          <p className="muted small">OpenStreetMap에서 시내 중심 1.5km 안의 식당을 찾는 중…</p>
        ) : eat.status === "error" ? (
          <p className="small">
            {eat.error}{" "}
            <button className="btn" onClick={onRetryEat}>
              다시 찾기
            </button>
          </p>
        ) : eat.picks?.length ? (
          <>
            <ol>
              {eat.picks.map((r) => (
                <li key={r.osmId}>
                  <a href={r.osmUrl} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                  {r.reason ? <span className="muted"> — {r.reason}</span> : null}
                  {r.openingHours ? <div className="muted small">영업시간(지도 데이터): {r.openingHours}</div> : null}
                </li>
              ))}
            </ol>
            <p className="muted small">
              지도에 등록된 식당 {eat.poolSize}곳 중 {eat.pickedBy === "ai" ? "AI가 일정의 음식 종류에 맞춰" : "현지 음식 우선 규칙으로"} 골랐습니다. 영업 여부는 방문 전 확인하세요.
            </p>
          </>
        ) : (
          <p className="muted small">지도 데이터에 등록된 식당을 찾지 못했습니다.</p>
        )}
      </div>
    </article>
  );
}
