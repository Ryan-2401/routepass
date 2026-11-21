// Gemini API 호출 + JSON 결과 검증
// AI 출력은 항상 zod 스키마로 검사하고, 틀리면 오류 내용을 알려주고 한 번 더 시도합니다.
import "server-only";
import type { z } from "zod";
import { env } from "@/lib/env";

export class AiError extends Error {}

async function callGemini(prompt: string, temperature: number): Promise<string> {
  if (!env.geminiKey) throw new AiError("GEMINI_API_KEY가 설정되지 않았습니다.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (res.status === 429) throw new AiError("Gemini 무료 사용량 한도에 걸렸습니다. 1분 뒤 다시 시도하세요.");
  if (!res.ok) throw new AiError(`Gemini 오류 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new AiError("Gemini가 빈 응답을 보냈습니다.");
  return text;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  return JSON.parse(t);
}

/**
 * 프롬프트를 보내고 스키마에 맞는 JSON을 받습니다.
 * extraCheck: 스키마 외에 코드로 검사할 규칙 (위반 내용을 문자열 배열로 반환)
 */
export async function generateJson<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  opts: { temperature?: number; extraCheck?: (v: z.infer<S>) => string[]; retries?: number } = {},
): Promise<{ value: z.infer<S>; attempts: number; fixes: string[] }> {
  const retries = opts.retries ?? 1;
  let lastProblems: string[] = [];
  const fixes: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const p =
      attempt === 0
        ? prompt
        : `${prompt}\n\n이전 응답에 다음 문제가 있었습니다. 고쳐서 JSON만 다시 출력하세요:\n- ${lastProblems.join("\n- ")}`;
    const text = await callGemini(p, opts.temperature ?? 0.6);
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch {
      lastProblems = ["JSON 형식이 아닙니다."];
      fixes.push(`시도 ${attempt + 1}: JSON 파싱 실패`);
      continue;
    }
    const r = schema.safeParse(parsed);
    if (!r.success) {
      lastProblems = r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);
      fixes.push(`시도 ${attempt + 1}: 스키마 위반 ${lastProblems.length}건`);
      continue;
    }
    const problems = opts.extraCheck?.(r.data) ?? [];
    if (problems.length) {
      lastProblems = problems;
      fixes.push(`시도 ${attempt + 1}: 규칙 위반 — ${problems.join(" / ")}`);
      continue;
    }
    return { value: r.data, attempts: attempt + 1, fixes };
  }
  throw new AiError(`AI 결과가 규칙을 계속 어겼습니다: ${lastProblems.join(" / ")}`);
}
