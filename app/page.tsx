"use client";
// 메인 화면: 입력 → 일정(AI) → 운행 확인·항공권·식당을 병렬로 채움 → 최저가 경로·출입국 계산
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CityBlock, { type EatState } from "@/components/CityBlock";
import EntryPanel from "@/components/EntryPanel";
import LegBlock, { type FlightState } from "@/components/LegBlock";
import PathCompare from "@/components/PathCompare";
import RouteLine from "@/components/RouteLine";
import TripForm from "@/components/TripForm";
import { AiTag } from "@/components/bits";
import { api, ApiError, pool, type PlanResponse } from "@/lib/client/api";
import bans from "@/data/travel-bans.json";
import { ROUTES } from "@/lib/incheon";
import { fetchRestaurants } from "@/lib/osm";
import { bestPaths, buildGraph, flightKey } from "@/lib/pathfind";
import type { EntryCheck, FlightOption, Leg, TripRequest, VerifyResult } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="map" /> });

type Step = "plan" | "verify" | "flights" | "eat" | "entry";
type StepState = "wait" | "run" | "done" | "fail";
const STEP_KO: Record<Step, string> = { plan: "일정 만들기", verify: "운행 여부 확인", flights: "항공권 검색", eat: "식당 찾기", entry: "출입국 계산" };

export default function Home() {
  const [keys, setKeys] = useState<Record<string, boolean | string> | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<{ msg: string; kind?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<Record<string, VerifyResult>>({});
  const [flights, setFlights] = useState<Record<string, FlightState>>({});
  const [eat, setEat] = useState<Record<number, EatState>>({});
  const [checks, setChecks] = useState<EntryCheck[] | null>(null);
  const [steps, setSteps] = useState<Partial<Record<Step, StepState>>>({});
  const [rtBusy, setRtBusy] = useState<Set<string>>(new Set());
  const run = useRef(0);

  useEffect(() => {
    api.status().then(setKeys).catch(() => setKeys(null));
  }, []);

  const step = (s: Step, v: StepState) => setSteps((x) => ({ ...x, [s]: v }));

  const loadEat = useCallback(async (p: PlanResponse, i: number, id: number) => {
    const stay = p.stays[i];
    setEat((e) => ({ ...e, [i]: { status: "loading" } }));
    const foodThemes = stay.days.flatMap((d) => d.items.filter((it) => it.kind === "food").map((it) => it.title));
    try {
      // 식당 목록은 브라우저에서 직접 가져옴 (서버 IP는 지도 서버에서 자주 막힘). 실패하면 서버가 다시 시도.
      const pool = await fetchRestaurants(stay.place.lat, stay.place.lng).catch(() => undefined);
      const r = await api.places({ lat: stay.place.lat, lng: stay.place.lng, country: stay.place.country, cityName: stay.place.name, foodThemes, count: 3, pool: pool?.slice(0, 60) });
      if (run.current === id) setEat((e) => ({ ...e, [i]: { status: "done", ...r } }));
    } catch (err) {
      if (run.current === id) setEat((e) => ({ ...e, [i]: { status: "error", error: (err as Error).message } }));
      throw err;
    }
  }, []);

  async function start(req: TripRequest) {
    const id = ++run.current;
    setBusy(true);
    setError(null);
    setPlan(null);
    setVerify({});
    setFlights({});
    setEat({});
    setChecks(null);
    setSteps({ plan: "run" });
    let p: PlanResponse;
    try {
      p = await api.plan(req);
    } catch (e) {
      if (run.current !== id) return;
      setError({ msg: (e as Error).message, kind: e instanceof ApiError ? e.kind : undefined });
      step("plan", "fail");
      setBusy(false);
      return;
    }
    if (run.current !== id) return;
    setPlan(p);
    step("plan", "done");
    setBusy(false);

    const demo = p.mode === "demo";
    const ground = p.legs.flatMap((l) => l.candidates.filter((c) => c.mode !== "flight").map((c) => ({ l, c })));
    const flightJobs: { key: string; leg: Leg; hub?: string; part?: "a" | "b" }[] = [];
    for (const l of p.legs) {
      if (!l.candidates.some((c) => c.mode === "flight")) continue;
      flightJobs.push({ key: flightKey(l.index), leg: l });
      for (const h of p.hubSuggestions[l.index] ?? []) {
        flightJobs.push({ key: flightKey(l.index, h, "a"), leg: l, hub: h, part: "a" });
        flightJobs.push({ key: flightKey(l.index, h, "b"), leg: l, hub: h, part: "b" });
      }
    }

    step("verify", "run");
    step("flights", "run");
    step("eat", "run");
    const vJob = pool(ground, 1, async ({ l, c }) => {
      const r = await api.verify(l, c.id).catch(
        (e): VerifyResult => ({ legIndex: l.index, candidateId: c.id, status: "unknown", summary: (e as Error).message, sources: [], method: "none", checkedAt: "" }),
      );
      if (run.current === id) setVerify((v) => ({ ...v, [c.id]: r }));
    }).then(() => step("verify", "done"));

    const fJob = pool(flightJobs, 2, async (j) => {
      setFlights((f) => ({ ...f, [j.key]: { status: "loading" } }));
      try {
        const r = await api.flights({ from: j.leg.from, to: j.leg.to, date: j.leg.date, realtime: false, demo, hub: j.hub, part: j.part });
        if (run.current === id) setFlights((f) => ({ ...f, [j.key]: { status: "done", result: r } }));
      } catch (e) {
        if (run.current === id) setFlights((f) => ({ ...f, [j.key]: { status: "error", error: (e as Error).message } }));
      }
    }).then(() => step("flights", "done"));

    let eatFailed = false;
    await vJob; // 운행 판정(AI)이 끝난 뒤 식당 선택(AI)을 시작해 분당 요청 한도를 넘지 않게
    const eJob = pool(
      p.stays.map((_, i) => i),
      1,
      async (i) => {
        if (i > 0) await new Promise((r) => setTimeout(r, 1100)); // Nominatim 이용 정책: 초당 1회
        await loadEat(p, i, id).catch(() => void (eatFailed = true));
      },
    ).then(() => step("eat", eatFailed ? "fail" : "done"));

    await Promise.all([vJob, fJob, eJob]);
  }

  async function realtime(key: string) {
    if (!plan) return;
    const leg = plan.legs[Number(key.replace("leg", ""))];
    setRtBusy((s) => new Set(s).add(key));
    try {
      const r = await api.flights({ from: leg.from, to: leg.to, date: leg.date, realtime: true, demo: plan.mode === "demo" });
      setFlights((f) => ({ ...f, [key]: { status: "done", result: r } }));
    } catch (e) {
      setFlights((f) => ({ ...f, [key]: { ...f[key], status: "error", error: (e as Error).message } }));
    } finally {
      setRtBusy((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  }

  /* ---------- 최저가 경로 (다익스트라) ---------- */
  const paths = useMemo(() => {
    if (!plan) return [];
    const fl: Record<string, FlightOption[]> = {};
    for (const [k, v] of Object.entries(flights)) if (v.result) fl[k] = v.result.options;
    return bestPaths(buildGraph({ legs: plan.legs, flights: fl, hubs: plan.hubSuggestions, verify }), plan.legs.length);
  }, [plan, flights, verify]);

  /* ---------- 출입국 (최저가 경로 기준으로 다시 계산) ---------- */
  const entryInput = useMemo(() => {
    if (!plan) return null;
    const best = paths.find((p) => p.objective === "price");
    const legs = plan.legs.map((l) => {
      const edges = best?.edges.filter((e) => e.legIndex === l.index) ?? [];
      const groundEdge = edges.find((e) => e.kind === "ground");
      const cand = groundEdge ? l.candidates.find((c) => c.id === groundEdge.ref) : undefined;
      const fallback = l.candidates.find((c) => verify[c.id]?.status !== "suspended") ?? l.candidates[0];
      return { fromCountry: l.from.country, toCountry: l.to.country, mode: cand?.mode ?? (edges.length ? "flight" : fallback?.mode ?? "flight") };
    });
    const transitCountries = (best?.edges ?? [])
      .filter((e) => e.selfTransfer && e.via)
      .map((e) => ROUTES.find((r) => r.iata === e.via)?.country)
      .filter((x): x is string => !!x);
    const stays = plan.stays.map((s) => ({ name: s.place.name, country: s.place.country, region: s.place.region, arrive: s.arrive, depart: s.depart }));
    return JSON.stringify({ stays, legs, transitCountries });
  }, [plan, paths, verify]);

  useEffect(() => {
    if (!entryInput) return;
    const t = setTimeout(() => {
      step("entry", "run");
      api
        .entry(JSON.parse(entryInput))
        .then((r) => {
          setChecks(r.checks);
          step("entry", "done");
        })
        .catch(() => step("entry", "fail"));
    }, 500);
    return () => clearTimeout(t);
  }, [entryInput]);

  const flightLegs = useMemo(() => new Set(Object.keys(flights).filter((k) => /^leg\d+$/.test(k)).map((k) => Number(k.slice(3)))), [flights]);
  const allRestaurants = useMemo(() => Object.values(eat).flatMap((e) => e.picks ?? []), [eat]);
  const demo = plan?.mode === "demo";

  function directNote(legIndex: number): string | undefined {
    if (!plan) return;
    const city = legIndex === 0 ? plan.stays[0] : legIndex === plan.legs.length - 1 ? plan.stays[plan.stays.length - 1] : null;
    if (!city) return;
    const g = plan.gateways.find((x) => x.city === city.place.name);
    if (!g || g.hasDirect) return;
    const near = g.nearest.map((n) => `${n.city} ${n.distanceKm.toLocaleString()}km`).join(", ");
    return `${g.suspendedDirect ? "인천 노선표에서 이 도시 직항은 운휴입니다" : "인천 노선표에 이 도시 직항이 없습니다"}. 환승편을 찾거나 가까운 직항 도시(${near})로 들어가는 방법을 비교하세요.`;
  }

  return (
    <div className="shell">
      <aside className="side">
        <TripForm busy={busy} onSubmit={start} keys={keys} />
      </aside>

      <main className="main">
        {error ? (
          <div className="banner error" role="alert">
            <b>{error.kind === "blocked" ? "일정을 만들 수 없습니다" : error.kind === "demo-only" ? "데모 모드 제한" : "일정을 만들지 못했습니다"}</b>
            <div>{error.msg}</div>
            {error.kind === "blocked" ? (
              <div className="small" style={{ marginTop: 6 }}>
                판단 근거:{" "}
                <a href={bans.source.url} target="_blank" rel="noreferrer">
                  {bans.source.title}
                </a>{" "}
                · AI가 아니라 외교부 여행금지 데이터로 판정했습니다. 특별한 사유가 있으면 외교부에 예외적 여권사용 허가를 신청해야 합니다.
              </div>
            ) : null}
          </div>
        ) : null}

        {!plan && !busy ? (
          <section className="empty">
            <h2>유럽 도시 순서만 정하세요. 이동과 국경은 앱이 확인합니다.</h2>
            <p>왼쪽에서 나라와 도시를 순서대로 고르고 일정 만들기를 누르면 아래 순서로 진행됩니다.</p>
            <ol>
              <li>AI가 도시별 하루 일정과 구간별 이동수단 후보를 만듭니다.</li>
              <li>각 이동수단이 지금도 운행하는지 출처와 함께 확인합니다. 운행이 끝난 노선은 경로에서 뺍니다.</li>
              <li>항공권 가격을 모아 최저가·최단시간 경로를 계산하고, 체류비를 더해 예산 범위 안인지 알려 줍니다.</li>
              <li>체류일 합산, 비자, 외교부 여행경보로 출입국 조건을 검사합니다.</li>
            </ol>
            <p className="muted small">
              처음이라면 왼쪽의 <b>예시로 채우기</b>를 눌러 파리 → 로마 → 런던 → 베를린 여정으로 써 보세요.
              {keys && !keys.gemini ? " (AI 키가 없으면 모스크바 → 상트페테르부르크 → 탈린 → 헬싱키 예시 여정만 됩니다.)" : ""}
            </p>
          </section>
        ) : null}

        {busy && !plan ? (
          <section className="empty" aria-live="polite">
            <h2>일정을 만드는 중입니다</h2>
            <p>도시 좌표를 찾고 AI가 일정을 쓰고 있습니다. 보통 10~30초 걸립니다.</p>
          </section>
        ) : null}

        {plan ? (
          <>
            <div className="page-head">
              <h2>
                {plan.stays.map((s) => s.place.name).join(" · ")} · {plan.stays.reduce((a, s) => a + s.nights, 0)}박
              </h2>
              <nav className="nav" aria-label="결과 바로가기">
                <a href="#itinerary">일정</a>
                <a href="#paths">경로 비교</a>
                <a href="#entry">출입국</a>
                <a href="#map">지도</a>
              </nav>
            </div>

            {demo ? (
              <div className="banner">
                데모 모드입니다. 일정과 이동수단 후보는 개발자가 작성한 예시이고, 운행 확인(저장된 사례)·식당(OpenStreetMap)·출입국 계산은 실제로 동작합니다.
                GEMINI_API_KEY를 넣으면 원하는 도시로 AI가 일정을 만듭니다.
              </div>
            ) : null}

            <RouteLine plan={plan} verify={verify} flightLegs={flightLegs} />

            <ul className="progress" aria-label="진행 상황">
              {(Object.keys(STEP_KO) as Step[]).map((s) => (
                <li key={s} data-state={steps[s] ?? "wait"}>
                  {STEP_KO[s]}
                </li>
              ))}
            </ul>

            <section className="section" id="itinerary">
              <h3>일정과 이동</h3>
              <p className="lede">
                도장은 이동수단의 현재 운행 상태입니다. 운행 중단으로 확인된 수단은 줄을 긋고 경로 계산에서 뺍니다. 추정 시간·금액은 AI 추정치이니 예약 전에 확인하세요.
              </p>
              <div className="timeline">
                {plan.legs.map((leg, i) => (
                  <div key={leg.index}>
                    <LegBlock
                      leg={leg}
                      demo={demo}
                      verify={verify}
                      flights={flights}
                      hubs={plan.hubSuggestions[leg.index] ?? []}
                      onRealtime={realtime}
                      realtimeBusy={rtBusy}
                      directNote={directNote(leg.index)}
                    />
                    {plan.stays[i] ? (
                      <CityBlock stay={plan.stays[i]} demo={demo} eat={eat[i]} onRetryEat={() => loadEat(plan, i, run.current).catch(() => {})} />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="section" id="paths">
              <h3>경로 비교와 예산</h3>
              <p className="lede">
                이동비는 모은 항공권과 이동수단으로 다익스트라 알고리즘이 계산한 값이고(운행 중단 수단 제외), 체류비는 AI가 도시별로 추정한 값입니다. 둘을 더해 예산 범위와 비교합니다.
              </p>
              <PathCompare plan={plan} paths={paths} />
            </section>

            <section className="section" id="entry">
              <h3>출입국 조건</h3>
              <p className="lede">AI를 쓰지 않고 출처가 있는 규칙과 날짜 계산으로만 판정합니다. 최저가 경로의 이동수단을 기준으로 다시 계산합니다.</p>
              <EntryPanel checks={checks} loading={steps.entry === "run"} />
            </section>

            <section className="section" id="map">
              <h3>지도</h3>
              <MapView plan={plan} restaurants={allRestaurants} />
            </section>

            {plan.tips.length ? (
              <section className="section">
                <h3>
                  여행 팁
                  <AiTag demo={demo} />
                </h3>
                <ul className="tips">
                  {plan.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {plan.validation.length ? (
              <section className="section">
                <h3>AI 결과 검증 기록</h3>
                <p className="validation">코드가 AI 응답을 검사해 다시 요청한 기록입니다: {plan.validation.join(" / ")}</p>
              </section>
            ) : null}

            <footer className="foot">
              일정 생성: {plan.generatedBy}. AI가 생성한 내용은 사실과 다를 수 있습니다. 운행 정보·가격·비자 규칙은 바뀔 수 있으니 예약과 출국 전에 운영사, 항공사, 외교부 해외안전여행(0404.go.kr)에서 다시 확인하세요.
              지도 데이터 © OpenStreetMap 기여자.
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
