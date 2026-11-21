"use client";
import { fmtKoDate } from "@/lib/dates";
import type { FlightSearchResult, Leg, VerifyResult } from "@/lib/types";
import { AiTag, hm, MODE_KO, Sources, Stamp, won } from "./bits";

export interface FlightState {
  status: "loading" | "done" | "error";
  result?: FlightSearchResult;
  error?: string;
}

function FlightTable({ title, st, onRealtime, realtimeBusy }: { title: string; st?: FlightState; onRealtime?: () => void; realtimeBusy?: boolean }) {
  if (!st) return null;
  const r = st.result;
  const sample = r?.options.some((o) => o.source === "sample");
  return (
    <div className="flights">
      <div className="bar">
        <b>{title}</b>
        {st.status === "loading" ? <span className="muted">검색 중…</span> : null}
        {r?.sourcesTried.map((s) => (
          <span key={s.source} className={`tag ${s.ok ? "" : "warn"}`}>
            {s.source}: {s.message}
          </span>
        ))}
        {onRealtime ? (
          <button className="btn" onClick={onRealtime} disabled={realtimeBusy}>
            {realtimeBusy ? "실시간 확인 중…" : "실시간 가격 확인 (SerpApi 1회 사용)"}
          </button>
        ) : null}
        {r ? (
          <a href={r.searchUrl} target="_blank" rel="noreferrer">
            Google Flights에서 직접 보기
          </a>
        ) : null}
      </div>
      {st.status === "error" ? <p className="small">{st.error}</p> : null}
      {sample ? <p className="small" style={{ color: "var(--cond)" }}>예시 가격입니다. 실제 항공권 가격이 아닙니다 (항공 데이터 키 없음).</p> : null}
      {r && r.options.length ? (
        <table>
          <thead>
            <tr>
              <th>가격(1인)</th>
              <th>항공사</th>
              <th>경유</th>
              <th>소요</th>
              <th>출처</th>
            </tr>
          </thead>
          <tbody>
            {r.options.slice(0, 6).map((o) => (
              <tr key={o.id}>
                <td className="price">{won(o.priceKRW)}</td>
                <td>{o.airlines.join(", ") || "-"}</td>
                <td>{o.via.length ? o.via.join(", ") : o.stops ? `${o.stops}회` : "직항"}</td>
                <td>{hm(o.durationMin)}</td>
                <td className="small">
                  {o.source === "serpapi" ? "실시간" : o.source === "travelpayouts" ? "캐시(최근 검색 기준)" : "예시"}
                  {o.bookingLink ? (
                    <>
                      {" · "}
                      <a href={o.bookingLink} target="_blank" rel="noreferrer">
                        보기
                      </a>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : r && st.status === "done" ? (
        <p className="muted small">검색 결과가 없습니다. 위 링크에서 직접 확인하세요.</p>
      ) : null}
    </div>
  );
}

export default function LegBlock(props: {
  leg: Leg;
  demo: boolean;
  verify: Record<string, VerifyResult>;
  flights: Record<string, FlightState>;
  hubs: string[];
  onRealtime: (key: string) => void;
  realtimeBusy: Set<string>;
  directNote?: string;
}) {
  const { leg } = props;
  const direct = props.flights[`leg${leg.index}`];
  return (
    <section className="leg" aria-label={`${leg.from.name}에서 ${leg.to.name}`}>
      <div className="leg-head">
        {leg.from.name} → {leg.to.name}
        <span className="km">
          {fmtKoDate(leg.date)} · 직선 {leg.distanceKm.toLocaleString()}km
        </span>
      </div>
      {props.directNote ? <p className="small" style={{ margin: "4px 0 0", color: "var(--cond)" }}>{props.directNote}</p> : null}
      <ul className="cands">
        {leg.candidates.map((c) => {
          const v = props.verify[c.id];
          const isFlight = c.mode === "flight";
          return (
            <li className="cand" key={c.id} data-status={v?.status}>
              <div>
                <div className="cand-mode">
                  {MODE_KO[c.mode]}
                  {c.operatorHint ? ` · ${c.operatorHint}` : ""}
                  {c.borderCrossing ? " · 국경 통과" : ""}
                  <AiTag demo={props.demo} />
                </div>
                <div className="cand-desc">{c.description}</div>
                <div className="cand-est">
                  추정 {hm(c.estDurationMin)}
                  {c.estPriceKRW ? ` · 약 ${won(c.estPriceKRW)}` : ""}
                  {c.notes ? ` · ${c.notes}` : ""}
                </div>
                {v && !isFlight ? (
                  <div className="cand-verdict">
                    {v.summary}
                    <span className="muted small">
                      {" "}
                      ({v.method === "knowledge-base" ? "출처 확인된 사례" : v.method === "search+ai" ? "웹 검색 결과를 AI가 판정" : "판정 못 함"} · {v.checkedAt})
                    </span>
                    {v.method === "search+ai" ? <AiTag /> : null}
                    <Sources list={v.sources} />
                  </div>
                ) : null}
              </div>
              {isFlight ? <span className="muted small">아래 항공권</span> : <Stamp s={v ? v.status : "pending"} />}
            </li>
          );
        })}
      </ul>
      {direct || props.hubs.length ? (
        <>
          <FlightTable
            title={`${leg.from.name} → ${leg.to.name} 항공권`}
            st={direct}
            onRealtime={() => props.onRealtime(`leg${leg.index}`)}
            realtimeBusy={props.realtimeBusy.has(`leg${leg.index}`)}
          />
          {props.hubs.map((h) => (
            <div key={h} style={{ marginTop: 12 }}>
              <p className="small" style={{ margin: "0 0 4px" }}>
                <b>별도 발권 조합: {h} 경유</b> — 표 두 장을 따로 사는 방법입니다. 앞 비행기가 늦어도 보상이 없고, 짐을 찾아 다시 부치려면 {h}에 입국해야 할 수 있습니다.
                <AiTag demo={props.demo} />
              </p>
              <FlightTable title={`1구간: ${leg.from.name} → ${h}`} st={props.flights[`leg${leg.index}:${h}:a`]} />
              <FlightTable title={`2구간: ${h} → ${leg.to.name}`} st={props.flights[`leg${leg.index}:${h}:b`]} />
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
