// Gemini API 호출 + JSON 결과 검증
// AI 출력은 항상 zod 스키마로 검사하고, 틀리면 오류 내용을 알려주고 한 번 더 시도합니다.
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";

export class AiError extends Error {}

const GEMMA_FALLBACKS = ["gemma-4-31b-it", "gemma-4-26b-a4b-it"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 503(서버 혼잡)·500이면 잠깐 쉬고 다시, 429(한도)나 계속 실패하면 다음 모델로 넘어갑니다. */
type Step = { provider: "gemini" | "groq"; model: string };

/**
 * AI 호출: 무료 모델을 차례로 시도
 * 기본 Gemini → 가벼운 Gemini → Groq GPT-OSS 120B(키 있을 때) → Gemma 4 → Groq GPT-OSS 20B
 * 한도가 회사·모델마다 따로라서, 하나가 붐비거나 한도에 걸려도 다음 것으로 넘어감
 */
async function callGemini(prompt: string, temperature: number): Promise<string> {
  if (!env.geminiKey && !env.groqKey) throw new AiError("GEMINI_API_KEY가 설정되지 않았습니다.");
  const gemini = env.geminiKey ? [...new Set([env.geminiModel, ...env.geminiFallbackModels])].map((model): Step => ({ provider: "gemini", model })) : [];
  const gemma = env.geminiKey ? GEMMA_FALLBACKS.map((model): Step => ({ provider: "gemini", model })) : [];
  const groq = (model: string): Step[] => (env.groqKey ? [{ provider: "groq", model }] : []);
  const steps: Step[] = [...gemini, ...groq("openai/gpt-oss-120b"), ...gemma, ...groq("openai/gpt-oss-20b")];
  const started = Date.now();
  const BUDGET = 150000; // 한 요청에 쓰는 최대 시간 (서버 함수 제한 300초 안)
  const PER_CALL = 50000; // 모델 하나가 시간을 다 써서 다음 모델을 못 쓰는 일이 없게
  const tried: string[] = [];
  for (const { provider, model } of steps) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - started > BUDGET - 10000) break;
      if (attempt > 0) await sleep(2500);
      const signal = AbortSignal.timeout(Math.max(10000, Math.min(PER_CALL, BUDGET - (Date.now() - started))));
      let res: Response;
      try {
        res =
          provider === "groq"
            ? await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.groqKey}` },
                body: JSON.stringify({
                  model,
                  messages: [{ role: "user", content: prompt }],
                  temperature,
                  response_format: { type: "json_object" },
                  reasoning_effort: "low",
                }),
                signal,
              })
            : await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: prompt }] }],
                  // Gemma는 JSON 모드 대신 프롬프트로 JSON을 받고 코드에서 꺼냄
                  generationConfig: model.startsWith("gemma") ? { temperature } : { responseMimeType: "application/json", temperature },
                }),
                signal,
              });
      } catch {
        tried.push(`${model} 시간 초과`);
        break;
      }
      if (res.ok) {
        let text = "";
        if (provider === "groq") {
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          text = data.choices?.[0]?.message?.content ?? "";
        } else {
          const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
          text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
        }
        if (text) {
          lastModel = model;
          return text;
        }
        tried.push(`${model} 빈 응답`);
        continue;
      }
      const body = (await res.text()).slice(0, 200);
      tried.push(`${model} ${res.status}`);
      if ((res.status === 503 || res.status === 500) && attempt === 0) continue; // 잠깐 쉬고 같은 모델 한 번 더
      if (res.status === 503 || res.status === 500) break; // 계속 붐비면 다음 모델로
      if (res.status === 429 && attempt === 0 && provider === "gemini") {
        await sleep(8000); // 분당 한도: 조금 기다렸다 한 번 더
        continue;
      }
      if ([400, 401, 403, 404, 413, 429].includes(res.status) && (provider === "groq" || res.status === 429 || res.status === 404)) break; // 다음 모델로
      throw new AiError(`Gemini 오류 ${res.status}: ${body}`);
    }
  }
  throw new AiError(`AI 서버가 지금 붐비거나 사용량 한도에 걸렸습니다. 1~2분 뒤 다시 시도하세요. (${tried.join(", ")})`);
}

/** 마지막으로 응답한 모델 (평가·로그용) */
export let lastModel = "";

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    // 설명 문장이 앞뒤에 붙은 경우: 첫 { 또는 [ 부터 마지막 } 또는 ] 까지
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start < 0 || end <= start) throw new Error("JSON 없음");
    return JSON.parse(t.slice(start, end + 1));
  }
}

/**
 * 프롬프트를 보내고 스키마에 맞는 JSON을 받습니다.
 * extraCheck: 스키마 외에 코드로 검사할 규칙 (위반 내용을 문자열 배열로 반환)
 */
export async function generateJson<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  opts: {
    temperature?: number;
    extraCheck?: (v: z.infer<S>) => string[];
    /** 고치면 좋지만 마지막 시도에서도 남으면 그대로 받아들이는 문제 (화면에 경고로 표시) */
    softCheck?: (v: z.infer<S>) => string[];
    retries?: number;
  } = {},
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
    let r = schema.safeParse(parsed);
    // AI가 {"items":[…]} 대신 […]만 보내는 경우: 배열 칸이 하나뿐인 스키마면 그 칸에 넣어 다시 검사
    if (!r.success && Array.isArray(parsed) && schema instanceof z.ZodObject) {
      const arrayKeys = Object.entries(schema.shape as Record<string, z.ZodTypeAny>).filter(([, v]) => v instanceof z.ZodArray);
      if (arrayKeys.length === 1) r = schema.safeParse({ [arrayKeys[0][0]]: parsed });
    }
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
    const soft = opts.softCheck?.(r.data) ?? [];
    if (soft.length && attempt < retries) {
      lastProblems = soft;
      fixes.push(`시도 ${attempt + 1}: 고칠 점 — ${soft.join(" / ")}`);
      continue;
    }
    if (soft.length) fixes.push(`남은 문제(경고로 표시): ${soft.join(" / ")}`);
    return { value: r.data, attempts: attempt + 1, fixes };
  }
  throw new AiError(`AI 결과가 규칙을 계속 어겼습니다: ${lastProblems.join(" / ")}`);
}
