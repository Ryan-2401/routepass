"use client";
import { fmtKoDate } from "@/lib/dates";
import type { FlightSearchResult, Leg, VerifyResult } from "@/lib/types";
import { AiTag, hm, MODE_KO, Sources, Stamp, won } from "./bits";

export interface FlightState {
  status: "loading" | "done" | "error";
  result?: FlightSearchResult;
  error?: string;
}

const minPrice = (st?: FlightState) => (st?.status === "done" && st.result?.options.length ? Math.min(...st.result.options.map((o) => o.priceKRW)) : undefined);

/**
 * 별도 발권 조합: 환승지는 코드가 우회 거리로 고르고, 두 표 최저가 합이 일반 연결편 최저가보다 5% 이상 쌀 때만 보여줌.
 * 더 비싸면 한 줄로 접어 "확인했지만 숨겼다"고 알려줌.
 */
function SelfTransfers({ leg, hubs, flights, direct }: { leg: Leg; hubs: string[]; flights: Record<string, FlightState>; direct?: FlightState }) {
  if (!hubs.length) return null;
  const combos = hubs.map((h) => {
    const a = flights[`leg${leg.index}:${h}:a`];
    const b = flights[`leg${leg.index}:${h}:b`];
    const pa = minPrice(a);
    const pb = minPrice(b);
    return { h, a, b, total: pa !== undefined && pb !== undefined ? pa + pb : undefined, loading: a?.status === "loading" || b?.status === "loading" };
  });
  if (combos.some((c) => c.loading) || direct?.status === "loading") return <p className="small muted">별도 발권(두 장 따로 사기) 조합도 확인하는 중…</p>;
  const base = minPrice(direct);
  const good = combos.filter((c) => c.total !== undefined && (base === undefined || c.total < base * 0.95));
  const hidden = combos.filter((c) => !good.includes(c));
  return (
    <>
      {good.map((c) => (
        <div key={c.h} style={{ marginTop: 12 }}>
          <p className="small" style={{ margin: "0 0 4px" }}>
            <b>
              별도 발권 조합: {c.h} 경유 · 합계 {won(c.total!)}
              {base !== undefined ? ` (일반 연결편보다 ${won(base - c.total!)} 쌈)` : " (일반 연결편 가격 없음)"}
            </b>{" "}
            — 표 두 장을 따로 사는 방법입니다. 앞 비행기가 늦어도 보상이 없고, 짐을 찾아 다시 부치려면 {c.h}에 입국해야 할 수 있습니다. 환승 시간을 넉넉히(3시간 이상) 잡으세요.
          </p>
          <FlightTable title={`1구간: ${leg.from.name} → ${c.h}`} st={c.a} />
          <FlightTable title={`2구간: ${c.h} → ${leg.to.name}`} st={c.b} />
        </div>
      ))}
      {hidden.length ? (
        <details className="small muted" style={{ marginTop: 8 }}>
          <summary>
            별도 발권 조합 {hidden.map((c) => `${c.h} 경유 ${c.total !== undefined ? won(c.total) : "가격 없음"}`).join(", ")}도 확인했지만
            {base !== undefined ? ` 일반 연결편(${won(base)})보다 싸지 않아 숨겼어요.` : " 가격을 찾지 못해 숨겼어요."}
          </summary>
          {hidden.map((c) => (
            <div key={c.h} style={{ marginTop: 8 }}>
              <FlightTable title={`1구간: ${leg.from.name} → ${c.h}`} st={c.a} />
              <FlightTable title={`2구간: ${c.h} → ${leg.to.name}`} st={c.b} />
            </div>
          ))}
        </details>
      ) : null}
    </>
  );
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
          <SelfTransfers leg={leg} hubs={props.hubs} flights={props.flights} direct={direct} />
        </>
      ) : null}
    </section>
  );
}
