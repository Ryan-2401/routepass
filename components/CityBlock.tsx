"use client";
import { countryName } from "@/lib/countries";
import { fmtKoDate } from "@/lib/dates";
import type { CityStay, Restaurant } from "@/lib/types";
import { AiTag, won } from "./bits";

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);

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
        {stay.days.map((d, di) => {
          const fees = d.items.reduce((sum, it) => sum + (it.costKRW ?? 0), 0);
          return (
            <details className="day" key={d.date} open>
              <summary>
                <span className="d">
                  {di + 1}일차 · {fmtKoDate(d.date)}
                </span>
                <span className="theme">{d.theme}</span>
                {d.area ? <span className="cat">{d.area}</span> : null}
              </summary>
              {d.intro ? <p className="day-intro">{d.intro}</p> : null}
              <ol className="timeline">
                {d.items.map((it, k) => (
                  <li key={k} data-kind={it.kind}>
                    <div className="when-col">
                      <b>{it.time ?? it.slot}</b>
                      {it.durationMin ? <span>{dur(it.durationMin)}</span> : it.time ? <span>{it.slot}</span> : null}
                    </div>
                    <div className="what">
                      <div className="t">
                        {it.kind === "food" ? "🍽 " : ""}
                        {it.title}
                        {it.costKRW !== undefined && it.kind === "sight" ? <span className="fee">{it.costKRW === 0 ? "무료" : `입장 약 ${won(it.costKRW)}`}</span> : null}
                      </div>
                      {it.desc ? <p className="desc">{it.desc}</p> : null}
                      {it.menu?.length ? (
                        <div className="menu small">
                          먹어볼 것:{" "}
                          {it.menu.map((m) => (
                            <span className="cat" key={m}>
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {it.note ? <div className="muted small">{it.note}</div> : null}
                      {it.tips?.map((t) => (
                        <div className="tip small" key={t}>
                          팁: {t}
                        </div>
                      ))}
                      {it.warning ? <div className="warn-line">⚠ {it.warning}</div> : null}
                      {it.moveNext ? <div className="move small">↓ {it.moveNext}</div> : null}
                    </div>
                  </li>
                ))}
              </ol>
              {fees ? <p className="muted small">이 날 입장료 합계 약 {won(fees)} (1인, AI 추정 — 공식 사이트에서 확인)</p> : null}
            </details>
          );
        })}
      </div>

      <div className="eat">
        <h5>
          지도에서 확인된 식당
          {eat?.pickedBy === "ai" ? <AiTag /> : null}
        </h5>
        {!eat || eat.status === "idle" || eat.status === "loading" ? (
          <p className="muted small">OpenStreetMap에서 시내 중심 근처 식당을 찾는 중…</p>
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
