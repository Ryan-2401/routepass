"use client";
import { useMemo, useState } from "react";
import citiesData from "@/data/cities.json";
import menuData from "@/data/city-menu.json";
import countriesData from "@/data/countries.json";
import bans from "@/data/travel-bans.json";
import { geocodeCity, type GeoHit } from "@/lib/client/geocode";
import type { LodgingClass, TripRequest } from "@/lib/types";

const INTERESTS = ["미술관", "역사", "현지 음식", "야경", "자연", "건축", "쇼핑", "덜 걷기"];
const LODGING: [LodgingClass, string][] = [
  ["any", "상관없음"],
  ["hostel", "호스텔"],
  ["3", "3성"],
  ["4", "4성"],
  ["5", "5성"],
];
const MEAL_PRESETS: [number, string][] = [
  [15000, "가볍게"],
  [40000, "보통"],
  [80000, "맛집 위주"],
  [200000, "미슐랭"],
];
const CUSTOM = "__custom__";

const COUNTRY_NAMES = countriesData.countries as Record<string, { ko: string }>;
const MENU = menuData.menu as Record<string, string[]>;
const CITY_EN = Object.fromEntries(citiesData.cities.map((c) => [`${c.country}:${c.name}`, c.nameEn]));
const CITY_REGION = Object.fromEntries(citiesData.cities.map((c) => [`${c.country}:${c.name}`, c.region]));

/** 고른 나라·도시가 외교부 여행금지(나라 전체 또는 지역)에 걸리는지 */
function banNote(country: string, city: string, cityRegion?: string): { level: "block" | "warn"; text: string } | null {
  if (!country) return null;
  if (bans.bannedCountries.includes(country)) {
    return {
      level: "block",
      text: `${COUNTRY_NAMES[country].ko}는 외교부 지정 여행금지 국가예요(지정 기간 ${bans.validUntil}까지). 허가 없이 가면 여권법 위반이 될 수 있어 이 나라가 들어간 일정은 만들지 않아요.`,
    };
  }
  const region = cityRegion ?? CITY_REGION[`${country}:${city}`];
  const r = bans.bannedRegions.find((b) => b.country === country && region && b.regions.includes(region));
  if (!r) return null;
  return r.scope === "whole"
    ? { level: "block", text: `${city}은(는) 외교부 여행금지 지역(${r.text})이라 일정을 만들지 않아요.` }
    : { level: "warn", text: `${city}이(가) 속한 지역에 여행금지 구역(${r.text})이 있어요. 숙소와 이동 경로가 그 구간에 들어가지 않는지 확인하세요.` };
}

/** 나라 목록(유럽): 자주 가는 나라 → 나머지 가나다순 */
function countryOptions() {
  const all = Object.keys(MENU);
  const popular = menuData.popular.filter((c) => all.includes(c));
  const rest = all.filter((c) => !popular.includes(c)).sort((a, b) => COUNTRY_NAMES[a].ko.localeCompare(COUNTRY_NAMES[b].ko, "ko"));
  return { popular, rest };
}

export const EXAMPLE = [
  { country: "FR", city: "파리", days: "3" },
  { country: "IT", city: "로마", days: "3" },
  { country: "GB", city: "런던", days: "2" },
  { country: "DE", city: "베를린", days: "2" },
];

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + 45);
  return d.toISOString().slice(0, 10);
}

type Row = { country: string; city: string; custom: string; days: string; geo?: GeoHit; geoMsg?: string };
const emptyRow = (): Row => ({ country: "", city: "", custom: "", days: "" });
const won = (n: number) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString("ko-KR")}원` : "");

export default function TripForm(props: { busy: boolean; onSubmit: (r: TripRequest) => void; keys: Record<string, boolean | string> | null }) {
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [start, setStart] = useState(defaultStart);
  const [budget, setBudget] = useState("3000000");
  const [tolerance, setTolerance] = useState("300000");
  const [lodging, setLodging] = useState<LodgingClass>("any");
  const [meal, setMeal] = useState("40000");
  const [interests, setInterests] = useState<string[]>(["미술관", "현지 음식"]);
  const [travelers, setTravelers] = useState(1);
  const [formError, setFormError] = useState("");
  const { popular, rest } = useMemo(countryOptions, []);

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, k) => k !== i) : [emptyRow()]));
  const [checking, setChecking] = useState(false);

  /** 직접 입력한 도시를 고른 나라 안에서 찾아 결과를 줄 아래에 표시 */
  async function lookup(i: number, row: Row): Promise<GeoHit | null> {
    if (row.city !== CUSTOM || !row.custom.trim() || !row.country) return null;
    update(i, { geoMsg: "찾는 중…", geo: undefined });
    const hit = await geocodeCity(row.custom.trim(), row.country).catch(() => null);
    update(i, hit ? { geo: hit, geoMsg: `찾음: ${hit.display.split(",").slice(0, 3).join(",")}${hit.viaAi ? ` (AI가 "${hit.viaAi}"로 바꿔 검색)` : ""}` } : { geo: undefined, geoMsg: `${COUNTRY_NAMES[row.country].ko}에서 "${row.custom.trim()}"을(를) 찾지 못했어요. 철자나 영어 이름을 확인하세요.` });
    return hit;
  }

  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const filled = rows.filter((r) => r.country || r.city || r.custom.trim());
    const incomplete = filled.findIndex((r) => !r.country || !r.city || (r.city === CUSTOM && !r.custom.trim()));
    if (!filled.length) return setFormError("나라와 도시를 하나 이상 고르세요.");
    if (incomplete >= 0) return setFormError(`${rows.indexOf(filled[incomplete]) + 1}번째 줄의 나라와 도시를 모두 고르세요.`);
    const b = Number(budget);
    const t = Number(tolerance || 0);
    if (!Number.isFinite(b) || b < 100000) return setFormError("1인 총예산을 10만 원 이상 숫자로 적어 주세요.");
    if (!Number.isFinite(t) || t < 0) return setFormError("허용 범위는 0 이상의 숫자로 적어 주세요.");
    const m = Number(meal);
    if (!Number.isFinite(m) || m < 5000) return setFormError("1끼 식비는 5,000원 이상 숫자로 적어 주세요.");
    setFormError("");
    // 직접 입력한 도시는 브라우저에서 먼저 찾음 (Nominatim 이용 정책: 초당 1회)
    const geos: (GeoHit | undefined)[] = [];
    setChecking(true);
    for (const r of filled) {
      if (r.city !== CUSTOM) {
        geos.push(undefined);
        continue;
      }
      const hit = r.geo ?? (await lookup(rows.indexOf(r), r));
      if (!r.geo) await new Promise((res) => setTimeout(res, 1100));
      if (!hit) {
        setChecking(false);
        return setFormError(`${rows.indexOf(r) + 1}번째 줄의 "${r.custom.trim()}"을(를) ${COUNTRY_NAMES[r.country].ko}에서 찾지 못했어요.`);
      }
      geos.push(hit);
    }
    setChecking(false);
    props.onSubmit({
      cities: filled.map((r, k) => ({
        name: r.city === CUSTOM ? r.custom.trim() : r.city,
        country: r.country,
        days: r.days ? Math.max(1, Number(r.days)) : undefined,
        geo: geos[k] ? { nameEn: geos[k]!.nameEn, lat: geos[k]!.lat, lng: geos[k]!.lng, region: geos[k]!.region } : undefined,
      })),
      startDate: start,
      budgetKRW: Math.round(b),
      budgetToleranceKRW: Math.round(t),
      lodgingClass: lodging,
      mealBudgetKRW: Math.round(m),
      interests,
      travelers,
    });
  }

  const k = props.keys;
  return (
    <form onSubmit={submit}>
      <h1 className="brand">RoutePass</h1>
      <p className="brand-sub">유럽 여행 플래너. 나라와 도시를 순서대로 고르면 일정, 이동 방법과 운행 여부, 출입국 조건, 예산을 함께 확인합니다. 출발과 도착은 인천입니다.</p>

      <div className="field">
        <span className="label">방문 순서 · 나라 · 도시 · 박 수 (비우면 3박)</span>
        {rows.map((r, i) => {
          const cities = MENU[r.country] ?? [];
          return (
            <div className="city-row" key={i}>
              <span className="n">{i + 1}</span>
              <select aria-label={`${i + 1}번째 나라`} value={r.country} onChange={(e) => update(i, { country: e.target.value, city: "", custom: "" })}>
                <option value="">나라 선택</option>
                <optgroup label="자주 가는 나라">
                  {popular.map((c) => (
                    <option key={c} value={c}>
                      {COUNTRY_NAMES[c].ko}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="유럽 전체 (가나다순)">
                  {rest.map((c) => {
                    const banned = bans.bannedCountries.includes(c);
                    return (
                      <option key={c} value={c}>
                        {COUNTRY_NAMES[c].ko}
                        {banned ? " (여행금지)" : ""}
                      </option>
                    );
                  })}
                </optgroup>
              </select>
              <select aria-label={`${i + 1}번째 도시`} value={r.city} disabled={!r.country} onChange={(e) => update(i, { city: e.target.value })}>
                <option value="">{r.country ? "도시 선택" : "나라 먼저"}</option>
                {cities.map((c) => (
                  <option key={c} value={c} title={CITY_EN[`${r.country}:${c}`]}>
                    {c}
                  </option>
                ))}
                {r.country ? <option value={CUSTOM}>직접 입력…</option> : null}
              </select>
              <input
                type="number"
                aria-label={`${i + 1}번째 도시 박 수`}
                min={1}
                max={30}
                placeholder="3박"
                title="박 수 (비우면 3박)"
                value={r.days}
                onChange={(e) => update(i, { days: e.target.value })}
              />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <button type="button" className="icon-btn" style={{ height: 16, fontSize: 10 }} aria-label={`${i + 1}번째를 위로`} onClick={() => move(i, -1)}>
                  ▲
                </button>
                <button type="button" className="icon-btn" style={{ height: 16, fontSize: 10 }} aria-label={`${i + 1}번째를 아래로`} onClick={() => move(i, 1)}>
                  ▼
                </button>
              </span>
              <button type="button" className="icon-btn remove-btn" aria-label={`${i + 1}번째 줄 삭제`} title="이 줄 삭제" onClick={() => remove(i)}>
                ✕
              </button>
              {(() => {
                const note = banNote(r.country, r.city === CUSTOM ? r.custom.trim() : r.city, r.city === CUSTOM ? r.geo?.region : undefined);
                return note ? (
                  <p className={`ban-note ${note.level}`} role="note">
                    {note.text}
                  </p>
                ) : null;
              })()}
              {r.city === CUSTOM ? (
                <>
                  <input
                    type="text"
                    className="custom-city"
                    aria-label={`${i + 1}번째 도시 직접 입력`}
                    placeholder={`${COUNTRY_NAMES[r.country]?.ko ?? ""}의 도시 이름 (한국어·영어)`}
                    value={r.custom}
                    onChange={(e) => update(i, { custom: e.target.value, geo: undefined, geoMsg: undefined })}
                    onBlur={() => lookup(i, r)}
                  />
                  {r.geoMsg ? <p className={`geo-msg ${r.geo ? "ok" : ""}`}>{r.geoMsg}</p> : null}
                </>
              ) : null}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {rows.length < 8 && (
            <button type="button" className="text-btn" onClick={() => setRows((r) => [...r, emptyRow()])}>
              도시 추가
            </button>
          )}
          {rows.length > 1 && (
            <button type="button" className="text-btn" onClick={() => setRows((r) => r.slice(0, -1))}>
              마지막 줄 빼기
            </button>
          )}
          <button type="button" className="text-btn" onClick={() => setRows(EXAMPLE.map((x) => ({ ...x, custom: "" })))}>
            예시로 채우기
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="start">인천 출발일</label>
        <input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
      </div>

      <div className="field">
        <div className="budget-row">
          <div>
            <label htmlFor="budget">1인 총예산 (원)</label>
            <input id="budget" type="number" inputMode="numeric" min={100000} step={10000} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tol">± 허용 범위 (원)</label>
            <input id="tol" type="number" inputMode="numeric" min={0} step={10000} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </div>
        </div>
        <p className="hint">
          허용: {won(Number(budget) - Number(tolerance || 0))} ~ {won(Number(budget) + Number(tolerance || 0))}
          <br />
          항공·교통·숙박·식비를 모두 포함한 1인 금액이에요.
        </p>
      </div>

      <div className="field">
        <span className="label">숙소 등급</span>
        <div className="seg seg-5" role="group" aria-label="숙소 등급">
          {LODGING.map(([v, t]) => (
            <button type="button" key={v} aria-pressed={lodging === v} onClick={() => setLodging(v)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="meal">1인 1끼 식비 상한 (원)</label>
        <div className="seg seg-4" role="group" aria-label="식비 빠른 선택" style={{ marginBottom: 6 }}>
          {MEAL_PRESETS.map(([v, t]) => (
            <button type="button" key={v} aria-pressed={Number(meal) === v} onClick={() => setMeal(String(v))}>
              {t}
            </button>
          ))}
        </div>
        <input id="meal" type="number" inputMode="numeric" min={5000} step={5000} value={meal} onChange={(e) => setMeal(e.target.value)} />
        <p className="hint">
          {won(Number(meal))}까지
          {Number(meal) >= 150000 ? " · 미슐랭·파인다이닝 식당도 찾아요" : Number(meal) <= 20000 ? " · 가성비·현지 식당 위주로 찾아요" : ""}
        </p>
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
      <button className="primary" type="submit" disabled={props.busy || checking}>
        {checking ? "직접 입력한 도시 찾는 중…" : props.busy ? "일정 만드는 중…" : "일정 만들기"}
      </button>

      <div className="key-status" aria-live="polite">
        {k ? (
          <>
            <div>
              <b>AI 일정</b> {k.gemini ? `연결됨 (${k.model})` : "키 없음 — 예시 여정만 가능"}
              {k.gemini ? (k.groq ? " · 예비: Gemma 4, Groq" : " · 예비: Gemma 4") : ""}
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
