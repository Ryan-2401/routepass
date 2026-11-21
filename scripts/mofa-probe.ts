// 외교부 여행경보 API가 실제로 어떤 모양으로 응답하는지 확인하는 스크립트
// 실행: npx tsx --conditions=react-server scripts/mofa-probe.ts RU
try {
  process.loadEnvFile(".env.local");
} catch {}

async function main() {
  const { fetchTravelWarning } = await import("@/lib/server/mofa");
  const iso = process.argv[2] ?? "RU";
  const r = await fetchTravelWarning(iso);
  console.log("찾은 단계:", r.level);
  console.log("찾은 문장:", r.texts);
  console.log("원본 응답(앞부분):", JSON.stringify(r.raw, null, 2).slice(0, 3000));
}
main().catch((e) => console.error(e));
