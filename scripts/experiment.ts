// 비교 실험: A) Gemini 단독(기억만) vs B) 웹 검색 + Gemini 판정
// 실행: npm run experiment   (GEMINI_API_KEY, TAVILY_API_KEY 필요)
// 결과: experiments/results-<날짜>.csv 와 콘솔 정확도 요약
// B는 지식베이스를 쓰지 않고 검색만으로 판정합니다 (지식베이스를 쓰면 정답을 미리 아는 셈이라 공정하지 않음).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* .env.local 없음 */
}

type Case = { id: string; from: string; to: string; mode: string; description: string; operatorHint?: string; expected: string; source: string };

async function main() {
  const { findLocalCity } = await import("@/lib/server/resolve");
  const { judgeWithoutSearch, judgeWithSearch } = await import("@/lib/server/verify");
  const { haversineKm } = await import("@/lib/geo");
  const { env } = await import("@/lib/env");
  if (!env.geminiKey || !env.tavilyKey) {
    console.error("GEMINI_API_KEY와 TAVILY_API_KEY가 .env.local에 있어야 합니다.");
    process.exit(1);
  }
  const cases = (JSON.parse(readFileSync("data/eval/transport-status.json", "utf8")) as { cases: Case[] }).cases;
  const rows: string[] = ["id,expected,A_status,A_correct,B_status,B_correct,B_sources,A_summary,B_summary"];
  let a = 0;
  let b = 0;
  for (const c of cases) {
    const from = findLocalCity(c.from)!;
    const to = findLocalCity(c.to)!;
    const cand = { id: c.id, mode: c.mode as "train", description: c.description, operatorHint: c.operatorHint };
    const leg = { index: 0, from, to, date: new Date().toISOString().slice(0, 10), distanceKm: haversineKm(from, to), candidates: [cand] };
    const A = await judgeWithoutSearch(leg, cand).catch((e) => ({ status: "error", summary: String(e) }));
    const B = await judgeWithSearch(leg, cand).catch((e) => ({ status: "error", summary: String(e), sources: [] }));
    const okA = A.status === c.expected;
    const okB = B.status === c.expected;
    a += okA ? 1 : 0;
    b += okB ? 1 : 0;
    const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
    rows.push([c.id, c.expected, A.status, okA, B.status, okB, B.sources.length, q(A.summary), q(B.summary)].join(","));
    console.log(`${c.id}: 정답 ${c.expected} | A ${A.status}${okA ? " ✓" : " ✗"} | B ${B.status}${okB ? " ✓" : " ✗"}`);
    await new Promise((r) => setTimeout(r, 4000)); // 무료 한도 보호
  }
  mkdirSync("experiments", { recursive: true });
  const file = `experiments/results-${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(file, "﻿" + rows.join("\n"));
  console.log(`\n정확도 A(AI 단독) ${a}/${cases.length}, B(검색+AI) ${b}/${cases.length}\n저장: ${file}`);
}

main();
