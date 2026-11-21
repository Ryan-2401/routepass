// 최저가/최단시간 경로 계산 (다익스트라 알고리즘)
// 가장 싼 경로는 AI가 아니라 이 알고리즘이 계산합니다. AI는 검색할 허브를 고르고 결과를 설명하는 역할만 합니다.
import type { FlightOption, Leg, VerifyResult } from "@/lib/types";

export type Objective = "price" | "time" | "balanced";

export interface Edge {
  from: string;
  to: string;
  legIndex: number;
  kind: "flight" | "ground";
  label: string;
  priceKRW: number;
  durationMin: number;
  estimated: boolean; // AI 추정치나 예시 가격이면 true
  selfTransfer: boolean; // 별도 발권 연결
  via?: string; // 별도 발권 환승 공항
  ref: string; // FlightOption.id 또는 TransportCandidate.id
  source: string;
}

export interface PathResult {
  objective: Objective;
  edges: Edge[];
  totalKRW: number;
  totalMin: number;
  estimatedParts: number;
  selfTransfers: number;
}

/** 시간 가치(원/분). balanced 모드에서 1시간 = 15,000원으로 환산 */
export const VALUE_OF_TIME_PER_MIN = 250;

export function weight(e: Edge, obj: Objective): number {
  if (obj === "price") return e.priceKRW;
  if (obj === "time") return e.durationMin;
  return e.priceKRW + e.durationMin * VALUE_OF_TIME_PER_MIN;
}

export function dijkstra(nodes: string[], edges: Edge[], start: string, goal: string, obj: Objective): Edge[] | null {
  const dist = new Map<string, number>(nodes.map((n) => [n, Infinity]));
  const prev = new Map<string, Edge>();
  dist.set(start, 0);
  const todo = new Set(nodes);
  while (todo.size) {
    let u: string | null = null;
    for (const n of todo) if (u === null || dist.get(n)! < dist.get(u)!) u = n;
    if (u === null || dist.get(u) === Infinity) break;
    todo.delete(u);
    if (u === goal) break;
    for (const e of edges) {
      if (e.from !== u) continue;
      const alt = dist.get(u)! + weight(e, obj);
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, e);
      }
    }
  }
  if (!prev.has(goal)) return null;
  const path: Edge[] = [];
  for (let n = goal; n !== start; ) {
    const e = prev.get(n)!;
    path.unshift(e);
    n = e.from;
  }
  return path;
}

export const nodeId = (i: number) => `N${i}`;

/** 화면에 쌓인 검색 결과로 그래프를 만듭니다. */
export function buildGraph(params: {
  legs: Leg[];
  flights: Record<string, FlightOption[]>; // key: flightKey(...)
  hubs: Record<number, string[]>;
  verify: Record<string, VerifyResult>; // key: candidateId
}): { nodes: string[]; edges: Edge[] } {
  const { legs, flights, hubs, verify } = params;
  const nodes = legs.map((_, i) => nodeId(i)).concat(nodeId(legs.length));
  const edges: Edge[] = [];

  for (const leg of legs) {
    const a = nodeId(leg.index);
    const b = nodeId(leg.index + 1);
    const direct = flights[flightKey(leg.index)] ?? [];
    for (const f of direct) edges.push(flightEdge(a, b, leg.index, f, false));

    for (const h of hubs[leg.index] ?? []) {
      const first = flights[flightKey(leg.index, h, "a")] ?? [];
      const second = flights[flightKey(leg.index, h, "b")] ?? [];
      if (!first.length || !second.length) continue;
      const mid = `${h}@${leg.index}`;
      nodes.push(mid);
      for (const f of first) edges.push(flightEdge(a, mid, leg.index, f, false));
      for (const f of second) edges.push({ ...flightEdge(mid, b, leg.index, f, true), via: h });
    }

    for (const c of leg.candidates) {
      const v = verify[c.id];
      if (v?.status === "suspended") continue; // 운행 중단은 경로에서 제외
      if (c.mode === "flight" && (direct.length || (hubs[leg.index] ?? []).length)) continue; // 실제 항공 데이터가 있으면 AI 추정 항공은 제외
      edges.push({
        from: a,
        to: b,
        legIndex: leg.index,
        kind: c.mode === "flight" ? "flight" : "ground",
        label: `${c.operatorHint ? c.operatorHint + " · " : ""}${c.description}`,
        priceKRW: c.estPriceKRW ?? Math.round(leg.distanceKm * 150),
        durationMin: c.estDurationMin ?? Math.round(leg.distanceKm / 60) * 60,
        estimated: true,
        selfTransfer: false,
        ref: c.id,
        source: "AI 추정",
      });
    }
  }
  return { nodes, edges };
}

function flightEdge(from: string, to: string, legIndex: number, f: FlightOption, selfTransfer: boolean): Edge {
  const via = f.via.length ? ` · 경유 ${f.via.join(", ")}` : f.stops ? ` · 경유 ${f.stops}회` : " · 직항";
  return {
    from,
    to,
    legIndex,
    kind: "flight",
    label: `${f.airlines.join(", ") || "항공편"}${via}`,
    priceKRW: f.priceKRW,
    durationMin: f.durationMin ?? 0,
    estimated: f.source === "sample",
    selfTransfer,
    ref: f.id,
    source: f.source,
  };
}

export function flightKey(legIndex: number, hub?: string, part?: "a" | "b") {
  return hub ? `leg${legIndex}:${hub}:${part}` : `leg${legIndex}`;
}

export function bestPaths(graph: { nodes: string[]; edges: Edge[] }, legCount: number): PathResult[] {
  const out: PathResult[] = [];
  for (const obj of ["price", "time", "balanced"] as Objective[]) {
    const p = dijkstra(graph.nodes, graph.edges, nodeId(0), nodeId(legCount), obj);
    if (!p) continue;
    out.push({
      objective: obj,
      edges: p,
      totalKRW: p.reduce((s, e) => s + e.priceKRW, 0),
      totalMin: p.reduce((s, e) => s + e.durationMin, 0),
      estimatedParts: p.filter((e) => e.estimated).length,
      selfTransfers: p.filter((e) => e.selfTransfer).length,
    });
  }
  return out;
}
