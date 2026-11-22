"use client";
// 도시별 '숙소·식당·명소 고르기'
// 후보 카드를 누르거나 끌어다 '내가 고른 곳'에 담으면, AI가 고른 곳만으로 날짜별 동선을 짜고 코드가 영업시간을 검사합니다.
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { findInCity, osmHotels } from "@/lib/client/osm-places";
import { fmtKoDate } from "@/lib/dates";
import { distanceKm } from "@/lib/geo";
import { fetchRestaurants } from "@/lib/osm";
import type { CityStay, DayRoute, PlaceOption, TripRequest } from "@/lib/types";
import { AiTag, won } from "./bits";

const CityRouteMap = dynamic(() => import("./CityRouteMap"), { ssr: false, loading: () => <div className="map small-map" /> });

import type { Selection } from "@/lib/budget";
export type { Selection };
export interface RouteResult {
  days: DayRoute[];
  unused: string[];
}

type Tab = "hotel" | "food" | "sight" | "youtuber" | "michelin";
type Load<T> = { status: "idle" | "loading" | "done" | "error"; items: T[]; message?: string; missed?: { name: string; url?: string; by?: string }[] };
const idle = <T,>(): Load<T> => ({ status: "idle", items: [] });

const TAB_KO: Record<Tab, string> = { hotel: "숙소", food: "식당", sight: "명소", youtuber: "스페셜 픽", michelin: "미슐랭" };
const FOOD_ORDER = ["현지 전통", "가성비", "카페·디저트", "분위기 좋은 저녁", "파인다이닝"];

function Card({ p, onAdd, added, demo }: { p: PlaceOption; onAdd: (p: PlaceOption) => void; added: boolean; demo: boolean }) {
  return (
    <li
      className={`pick-card ${added ? "added" : ""}`}
      draggable={!added}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className="pick-main">
        <div className="pick-name">
          {p.special ? <span className="special-badge">스페셜 픽 · {p.special.by}</span> : null}
          {p.name}
        </div>
        <div className="pick-meta">
          {p.stars ? <span>{"★".repeat(Math.round(p.stars))} {p.stars}성</span> : null}
          {p.priceKRW ? <span className="price">1박 {won(p.priceKRW)}</span> : null}
          {p.kind === "hotel" && !p.priceKRW ? <span className="muted">가격 정보 없음</span> : null}
          {p.rating ? (
            <span>
              평점 {p.rating}
              {p.reviews ? ` (${p.reviews.toLocaleString()})` : ""}
            </span>
          ) : null}
          {p.category && !p.special ? <span className="cat">{p.category}</span> : null}
          {p.priceNote ? <span>{p.priceNote}</span> : null}
        </div>
        {p.reason ? (
          <div className="pick-reason">
            {p.reason}
            {p.source === "osm" && p.kind === "restaurant" ? <AiTag demo={demo} /> : null}
          </div>
        ) : null}
        <div className="pick-meta small">
          {p.openingHours ? <span>영업시간(지도): {p.openingHours}</span> : p.hoursText ? <span>{p.hoursText}</span> : p.kind !== "hotel" ? <span className="muted">영업시간 정보 없음</span> : null}
        </div>
        <div className="pick-links small">
          <a href={p.mapUrl} target="_blank" rel="noreferrer">
            지도
          </a>
          {p.link ? (
            <a href={p.link} target="_blank" rel="noreferrer">
              {p.kind === "hotel" ? "예약·상세" : "웹사이트"}
            </a>
          ) : null}
          {p.special ? (
            <a href={p.special.url} target="_blank" rel="noreferrer" title={p.special.title}>
              출처
            </a>
          ) : null}
        </div>
      </div>
      <button type="button" className="btn" onClick={() => onAdd(p)} disabled={added} aria-label={`${p.name} 담기`}>
        {added ? "담음" : p.kind === "hotel" ? "이 숙소로" : "담기"}
      </button>
    </li>
  );
}

export default function PlacePicker(props: {
  stay: CityStay;
  request: TripRequest;
  demo: boolean;
  selection: Selection;
  onChange: (s: Selection) => void;
  route?: RouteResult;
  onRoute: (r: RouteResult | undefined) => void;
}) {
  const { stay, request, selection } = props;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("hotel");
  const [hotels, setHotels] = useState<Load<PlaceOption>>(idle);
  const [food, setFood] = useState<Load<PlaceOption>>(idle);
  const [sights, setSights] = useState<Load<PlaceOption>>(idle);
  const [youtuber, setYoutuber] = useState<Load<PlaceOption>>(idle);
  const [michelin, setMichelin] = useState<Load<PlaceOption>>(idle);
  const [foodCat, setFoodCat] = useState<string>("전체");
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const registry = useRef(new Map<string, PlaceOption>());

  const remember = (list: PlaceOption[]) => list.forEach((p) => registry.current.set(p.id, p));
  const city = stay.place;
  const dates = stay.days.map((d) => d.date);
  const pickedIds = new Set([selection.hotel?.id, ...selection.picks.map((p) => p.id)].filter(Boolean) as string[]);

  async function loadHotels() {
    setHotels({ status: "loading", items: [], message: "Google 호텔 검색 중…" });
    try {
      const r = await api.hotels({ cityEn: city.nameEn, checkIn: stay.arrive, checkOut: stay.depart, adults: request.travelers, lodgingClass: request.lodgingClass });
      if (r.options.length) {
        const sorted = [...r.options].sort((a, b) => (a.priceKRW ?? Infinity) - (b.priceKRW ?? Infinity));
        remember(sorted);
        return setHotels({ status: "done", items: sorted, message: r.message });
      }
      const osm = await osmHotels(city.lat, city.lng, request.lodgingClass === "hostel");
      const filtered = ["3", "4", "5"].includes(request.lodgingClass) ? osm.filter((h) => !h.stars || h.stars >= Number(request.lodgingClass)) : osm;
      remember(filtered);
      setHotels({ status: "done", items: filtered, message: `${r.message} 대신 지도에 등록된 숙소를 보여줘요(가격 없음).` });
    } catch (e) {
      setHotels({ status: "error", items: [], message: (e as Error).message });
    }
  }

  async function loadFood() {
    setFood({ status: "loading", items: [], message: "지도에서 식당을 모으고 AI가 분류하는 중…" });
    try {
      const pool = await fetchRestaurants(city.lat, city.lng);
      const themes = stay.days.flatMap((d) => d.items.filter((i) => i.kind === "food").map((i) => i.title));
      const r = await api.curate({ cityName: city.name, mealBudgetKRW: request.mealBudgetKRW, themes, pool: pool.slice(0, 60) });
      remember(r.options);
      setFood({ status: "done", items: r.options, message: `지도에 등록된 식당 ${pool.length}곳 중 ${r.options.length}곳` });
    } catch (e) {
      setFood({ status: "error", items: [], message: (e as Error).message });
    }
  }

  async function loadSights() {
    const items = stay.days.flatMap((d) => d.items.filter((i) => i.kind === "sight"));
    const uniq = items.filter((it, i) => items.findIndex((x) => (x.placeEn || x.title) === (it.placeEn || it.title)) === i).slice(0, 10);
    setSights({ status: "loading", items: [], message: `일정의 명소 ${uniq.length}곳을 지도에서 확인하는 중…` });
    const found: PlaceOption[] = [];
    const missed: { name: string }[] = [];
    for (const it of uniq) {
      const q = it.placeEn || it.title.replace(/\(.*?\)/g, "").split(/[,·—-]/)[0].trim();
      const hit = await findInCity(q, city.lat, city.lng).catch(() => null);
      if (hit) {
        found.push({
          id: `sight-${found.length}-${q.slice(0, 30)}`,
          kind: "sight",
          name: it.title,
          lat: hit.lat,
          lng: hit.lng,
          openingHours: hit.openingHours,
          mapUrl: hit.mapUrl,
          source: "ai-plan",
          reason: it.note,
        });
      } else missed.push({ name: it.title });
      setSights({ status: "loading", items: [...found], missed: [...missed], message: `지도에서 확인 중… (${found.length + missed.length}/${uniq.length})` });
    }
    remember(found);
    setSights({ status: "done", items: found, missed, message: `AI 일정의 명소 중 지도에서 위치를 확인한 ${found.length}곳` });
  }

  async function loadSpecial(kind: "youtuber" | "michelin") {
    const set = kind === "youtuber" ? setYoutuber : setMichelin;
    set({ status: "loading", items: [], message: kind === "youtuber" ? "유튜버 추천 맛집을 웹에서 찾는 중…" : "미슐랭 가이드 식당을 웹에서 찾는 중…" });
    try {
      const r = await api.special({ cityName: city.name, cityEn: city.nameEn, kind });
      const found: PlaceOption[] = [];
      const missed: { name: string; url?: string; by?: string }[] = [];
      for (const it of r.items.slice(0, 8)) {
        const hit = await findInCity(it.searchName, city.lat, city.lng).catch(() => null);
        if (!hit) {
          missed.push({ name: it.name, url: it.source.url, by: it.by });
          continue;
        }
        found.push({
          id: `${kind}-${found.length}-${it.searchName.slice(0, 30)}`,
          kind: "restaurant",
          name: it.name,
          lat: hit.lat,
          lng: hit.lng,
          category: kind === "youtuber" ? "스페셜 픽" : "미슐랭 가이드",
          openingHours: hit.openingHours,
          hoursText: it.hoursText,
          mapUrl: hit.mapUrl,
          source: "search+ai",
          special: { by: it.by, title: it.source.title, url: it.source.url },
        });
        set({ status: "loading", items: [...found], missed: [...missed], message: "지도에서 위치 확인 중…" });
      }
      remember(found);
      set({
        status: "done",
        items: found,
        missed,
        message: r.items.length ? `검색 결과에서 찾은 ${r.items.length}곳 중 지도에서 위치를 확인한 ${found.length}곳` : "검색 결과에서 근거가 있는 식당을 찾지 못했어요.",
      });
    } catch (e) {
      set({ status: "error", items: [], message: (e as Error).message });
    }
  }

  function openTab(t: Tab) {
    setTab(t);
    if (t === "hotel" && hotels.status === "idle") loadHotels();
    if (t === "food" && food.status === "idle") loadFood();
    if (t === "sight" && sights.status === "idle") loadSights();
    if (t === "youtuber" && youtuber.status === "idle") loadSpecial("youtuber");
    if (t === "michelin" && michelin.status === "idle") loadSpecial("michelin");
  }

  function add(p: PlaceOption) {
    props.onRoute(undefined); // 고른 곳이 바뀌면 이전 동선은 무효
    if (p.kind === "hotel") props.onChange({ ...selection, hotel: p });
    else if (!selection.picks.some((x) => x.id === p.id) && selection.picks.length < 30) props.onChange({ ...selection, picks: [...selection.picks, p] });
  }
  function remove(id: string) {
    props.onRoute(undefined);
    if (selection.hotel?.id === id) props.onChange({ ...selection, hotel: undefined });
    else props.onChange({ ...selection, picks: selection.picks.filter((p) => p.id !== id) });
  }

  async function makeRoute() {
    setPlanning(true);
    setPlanError("");
    try {
      props.onRoute(await api.replan({ cityName: city.name, dates, arriveDate: stay.arrive, hotel: selection.hotel, picks: selection.picks }));
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  }

  const byId = useMemo(() => new Map([...(selection.hotel ? [selection.hotel] : []), ...selection.picks].map((p) => [p.id, p])), [selection]);

  /** 이 날 동선에서 600m 안에 있는 맛집 (아직 안 고른 곳, 카테고리별) */
  function nearbyFood(day: DayRoute) {
    const stops = day.stops.map((s) => byId.get(s.id)).filter((x): x is PlaceOption => !!x);
    const pool = [...food.items, ...youtuber.items, ...michelin.items].filter((r) => !pickedIds.has(r.id));
    const near = pool.filter((r) => stops.some((s) => distanceKm(s, r) <= 0.6));
    const groups = new Map<string, PlaceOption[]>();
    for (const r of near) {
      const k = r.category ?? "기타";
      if (!groups.has(k)) groups.set(k, []);
      if (groups.get(k)!.length < 3) groups.get(k)!.push(r);
    }
    return [...groups.entries()];
  }

  const current: Load<PlaceOption> = { hotel: hotels, food, sight: sights, youtuber, michelin }[tab];
  const foodCats = ["전체", ...FOOD_ORDER.filter((c) => food.items.some((f) => f.category === c))];
  const shown = tab === "food" && foodCat !== "전체" ? current.items.filter((p) => p.category === foodCat) : current.items;
  const nights = stay.nights;

  if (!open) {
    return (
      <div className="picker-closed">
        <button type="button" className="btn" onClick={() => (setOpen(true), openTab("hotel"))}>
          숙소·식당·명소 직접 고르고 동선 짜기
        </button>
        {selection.hotel || selection.picks.length ? (
          <span className="small muted">
            {" "}
            고른 곳: {selection.hotel ? `숙소 1곳, ` : ""}
            {selection.picks.length}곳
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <section className="picker" aria-label={`${city.name} 장소 고르기`}>
      <div className="picker-head">
        <h5>{city.name}에서 묵을 곳과 갈 곳 고르기</h5>
        <button type="button" className="text-link" onClick={() => setOpen(false)}>
          접기
        </button>
      </div>
      <div className="picker-grid">
        <div>
          <div className="tabs" role="tablist">
            {(Object.keys(TAB_KO) as Tab[]).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => openTab(t)}>
                {TAB_KO[t]}
              </button>
            ))}
          </div>
          {tab === "food" && food.status === "done" ? (
            <div className="chips light" role="group" aria-label="식당 카테고리">
              {foodCats.map((c) => (
                <button type="button" key={c} className="chip" aria-pressed={foodCat === c} onClick={() => setFoodCat(c)}>
                  {c}
                </button>
              ))}
            </div>
          ) : null}
          {tab === "michelin" && request.mealBudgetKRW < 150000 ? (
            <p className="small muted">1끼 식비 상한({won(request.mealBudgetKRW)})보다 비쌀 수 있어요. 참고용으로 보여줘요.</p>
          ) : null}
          {tab === "youtuber" || tab === "michelin" ? (
            <p className="small muted">
              웹 검색 결과에 이름과 추천 사실이 적힌 곳만, 지도에서 위치를 확인한 뒤 보여줘요. 카드의 출처 링크로 원문을 꼭 확인하세요.
              <AiTag demo={props.demo} />
            </p>
          ) : null}
          <p className="small muted" aria-live="polite">
            {current.message}
            {current.status === "error" ? (
              <>
                {" "}
                <button type="button" className="text-link" onClick={() => ((tab === "hotel" ? setHotels : tab === "food" ? setFood : tab === "sight" ? setSights : tab === "youtuber" ? setYoutuber : setMichelin)(idle()), setTimeout(() => openTab(tab), 0))}>
                  다시 시도
                </button>
              </>
            ) : null}
          </p>
          <ul className="pick-list">
            {shown.map((p) => (
              <Card key={p.id} p={p} onAdd={add} added={pickedIds.has(p.id)} demo={props.demo} />
            ))}
          </ul>
          {current.missed?.length ? (
            <details className="small muted">
              <summary>지도에서 위치를 못 찾은 곳 {current.missed.length}곳 (고를 수 없음)</summary>
              <ul>
                {current.missed.map((m) => (
                  <li key={m.name}>
                    {m.name}
                    {m.by ? ` · ${m.by}` : ""}
                    {m.url ? (
                      <>
                        {" "}
                        <a href={m.url} target="_blank" rel="noreferrer">
                          출처
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <aside
          className={`basket ${dragOver ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const p = registry.current.get(e.dataTransfer.getData("text/plain"));
            if (p) add(p);
          }}
          aria-label="내가 고른 곳"
        >
          <h6>내가 고른 곳</h6>
          <p className="small muted">카드를 여기로 끌어오거나 담기를 누르세요.</p>
          <div className="basket-hotel">
            <b>숙소</b>{" "}
            {selection.hotel ? (
              <>
                {selection.hotel.name}
                {selection.hotel.priceKRW ? ` · 1박 ${won(selection.hotel.priceKRW)} × ${nights}박 = ${won(selection.hotel.priceKRW * nights)}` : ""}
                <button type="button" className="x" aria-label="숙소 빼기" onClick={() => remove(selection.hotel!.id)}>
                  ✕
                </button>
              </>
            ) : (
              <span className="muted">아직 안 고름</span>
            )}
          </div>
          <ol className="basket-list">
            {selection.picks.map((p) => (
              <li key={p.id}>
                <span className={`kind ${p.kind}`}>{p.kind === "restaurant" ? "식당" : "명소"}</span> {p.name}
                <button type="button" className="x" aria-label={`${p.name} 빼기`} onClick={() => remove(p.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="primary small-primary" disabled={!selection.picks.length || planning} onClick={makeRoute}>
            {planning ? "AI가 동선 짜는 중…" : "고른 곳으로 동선 짜기"}
          </button>
          {planError ? <p className="small" style={{ color: "var(--stop)" }}>{planError}</p> : null}
        </aside>
      </div>

      {props.route ? (
        <div className="route-result">
          <h5>
            고른 곳으로 짠 동선 <AiTag demo={props.demo} />
          </h5>
          <p className="small muted">시간·순서·설명은 AI가 정했고, 영업시간 충돌과 장소 사이 거리·이동 시간은 코드가 지도 좌표로 다시 계산했어요(직선거리 기준 추정).</p>
          <CityRouteMap days={props.route.days} byId={byId} hotel={selection.hotel} />
          <div className="route-days">
            {props.route.days.map((d, di) => (
              <section key={d.date} className="route-day">
                <div className="d">
                  {di + 1}일차 · {fmtKoDate(d.date)} <span className="muted small">· 이동 직선거리 약 {d.walkKm}km</span>
                </div>
                {d.stops.length ? (
                  <ol className="route-stops">
                    {d.stops.map((s) => (
                      <li key={s.id}>
                        {s.move ? <div className="move small muted">↓ {s.move}</div> : null}
                        <b>{s.time}</b> {byId.get(s.id)?.name}
                        {s.durationMin ? <span className="muted small"> · {s.durationMin >= 60 ? `${Math.floor(s.durationMin / 60)}시간${s.durationMin % 60 ? ` ${s.durationMin % 60}분` : ""}` : `${s.durationMin}분`}</span> : null}
                        {s.note ? <div className="small">{s.note}</div> : null}
                        {s.tip ? <div className="small" style={{ color: "var(--changed)" }}>팁: {s.tip}</div> : null}
                        {s.warning ? <div className="warn-line">⚠ {s.warning}</div> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="small muted">이 날은 고른 곳이 없어요. 자유 일정이에요.</p>
                )}
                {(() => {
                  const groups = nearbyFood(d);
                  if (!groups.length) return food.status === "done" ? null : <p className="small muted">식당 탭을 열면 이 동선 근처 맛집도 카테고리별로 보여줘요.</p>;
                  return (
                    <div className="nearby">
                      <b className="small">이 동선 근처 맛집 (600m 안)</b>
                      {groups.map(([cat, list]) => (
                        <div key={cat} className="small">
                          <span className="cat">{cat}</span>{" "}
                          {list.map((r, i) => (
                            <span key={r.id}>
                              {i ? ", " : ""}
                              <button type="button" className="text-link" onClick={() => add(r)} title="담기">
                                {r.name}
                              </button>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>
            ))}
          </div>
          {props.route.unused.length ? (
            <p className="small muted">일정에 넣지 못한 곳: {props.route.unused.map((id) => byId.get(id)?.name).join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
