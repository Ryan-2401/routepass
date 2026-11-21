"use client";
import { useState } from "react";
import type { TripRequest } from "@/lib/types";

const INTERESTS = ["미술관", "역사", "현지 음식", "야경", "자연", "건축", "쇼핑", "덜 걷기"];

export const DEMO_CITIES = [
  { name: "모스크바", days: 3 },
  { name: "상트페테르부르크", days: 3 },
  { name: "탈린", days: 2 },
  { name: "헬싱키", days: 2 },
];

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + 45);
  return d.toISOString().slice(0, 10);
}

type Row = { name: string; days: string };

export default function TripForm(props: { busy: boolean; onSubmit: (r: TripRequest) => void; keys: Record<string, boolean | string> | null }) {
  const [rows, setRows] = useState<Row[]>([
    { name: "", days: "" },
    { name: "", days: "" },
  ]);
  const [formError, setFormError] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [budget, setBudget] = useState<TripRequest["budget"]>("mid");
  const [interests, setInterests] = useState<string[]>(["미술관", "현지 음식"]);
  const [travelers, setTravelers] = useState(1);

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cities = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), days: r.days ? Math.max(1, Number(r.days)) : undefined }));
    if (!cities.length) {
      setFormError("방문할 도시를 하나 이상 입력하세요.");
      return;
    }
    setFormError("");
    props.onSubmit({ cities, startDate: start, budget, interests, travelers });
  }

  const k = props.keys;
  return (
    <form onSubmit={submit}>
      <h1 className="brand">RoutePass</h1>
      <p className="brand-sub">방문할 도시를 순서대로 넣으면 일정, 이동 방법과 운행 여부, 출입국 조건을 함께 확인합니다. 출발과 도착은 인천입니다.</p>

      <div className="field">
        <span className="label">방문 도시 (순서대로) · 박 수 (비우면 3박)</span>
        {rows.map((r, i) => (
          <div className="city-row" key={i}>
            <span className="n">{i + 1}</span>
            <input
              type="text"
              aria-label={`${i + 1}번째 도시`}
              placeholder="도시 이름 (예: 민스크)"
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              type="number"
              aria-label={`${i + 1}번째 도시 박 수`}
              min={1}
              max={30}
              placeholder="박"
              value={r.days}
              onChange={(e) => update(i, { days: e.target.value })}
            />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <button type="button" className="icon-btn" style={{ height: 16, fontSize: 10 }} aria-label="위로" onClick={() => move(i, -1)}>
                ▲
              </button>
              <button type="button" className="icon-btn" style={{ height: 16, fontSize: 10 }} aria-label="아래로" onClick={() => move(i, 1)}>
                ▼
              </button>
            </span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 16 }}>
          {rows.length < 8 && (
            <button type="button" className="text-btn" onClick={() => setRows((r) => [...r, { name: "", days: "2" }])}>
              도시 추가
            </button>
          )}
          {rows.length > 1 && (
            <button type="button" className="text-btn" onClick={() => setRows((r) => r.slice(0, -1))}>
              마지막 도시 빼기
            </button>
          )}
          <button type="button" className="text-btn" onClick={() => setRows(DEMO_CITIES.map((c) => ({ name: c.name, days: String(c.days) })))}>
            예시로 채우기
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="start">인천 출발일</label>
        <input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
      </div>

      <div className="field">
        <span className="label">예산</span>
        <div className="seg" role="group" aria-label="예산">
          {(
            [
              ["low", "아끼기"],
              ["mid", "보통"],
              ["high", "여유"],
            ] as const
          ).map(([v, t]) => (
            <button type="button" key={v} aria-pressed={budget === v} onClick={() => setBudget(v)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">관심사</span>
        <div className="chips">
          {INTERESTS.map((t) => (
            <button
              type="button"
              key={t}
              className="chip"
              aria-pressed={interests.includes(t)}
              onClick={() => setInterests((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="trav">인원</label>
        <input id="trav" type="number" min={1} max={10} value={travelers} onChange={(e) => setTravelers(Math.max(1, Number(e.target.value)))} />
      </div>

      {formError ? (
        <p role="alert" style={{ color: "#ffd7d2", margin: "0 0 12px", fontSize: 14 }}>
          {formError}
        </p>
      ) : null}
      <button className="primary" type="submit" disabled={props.busy}>
        {props.busy ? "일정 만드는 중…" : "일정 만들기"}
      </button>

      <div className="key-status" aria-live="polite">
        {k ? (
          <>
            <div>
              <b>AI 일정</b> {k.gemini ? `연결됨 (${k.model})` : "키 없음 — 예시 여정만 가능"}
            </div>
            <div>
              <b>운행 검색</b> {k.tavily ? "연결됨" : "키 없음 — 저장된 사례만 판정"}
            </div>
            <div>
              <b>항공 가격</b> {k.travelpayouts || k.serpapi ? [k.travelpayouts && "캐시", k.serpapi && "실시간"].filter(Boolean).join(" · ") : "키 없음 — 예시 가격"}
            </div>
            <div>
              <b>외교부 여행경보</b> {k.mofa ? "실시간 조회" : "키 없음 — 저장된 데이터 사용"}
            </div>
          </>
        ) : (
          "연결 상태 확인 중…"
        )}
      </div>
    </form>
  );
}
