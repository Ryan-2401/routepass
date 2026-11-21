// 한국어로 적은 지명을 현지 표기(영어 알파벳)로 바꿔 주는 API
// 지도 데이터(OpenStreetMap)에 한국어 이름이 없는 소도시를 찾을 때 씁니다. AI 결과는 검색어 후보일 뿐이고,
// 실제 도시인지는 브라우저가 지도 검색으로 다시 확인합니다.
import { z } from "zod";
import { countryEn } from "@/lib/countries";
import { env } from "@/lib/env";
import { generateJson } from "@/lib/server/gemini";
import { json, readBody } from "@/lib/server/http";

const Body = z.object({ name: z.string().min(1).max(60), country: z.string().length(2) });
const Out = z.object({ candidates: z.array(z.string().min(1).max(80)).max(3) });

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  if (!env.geminiKey) return json({ candidates: [] });
  const prompt = `"${body.name}"은(는) ${countryEn(body.country)}에 있는 도시(또는 마을) 이름을 한국어로 적은 것입니다.
지도에서 검색할 수 있게 현지 공식 표기와 영어 표기를 최대 3개 주세요. 확실하지 않으면 빈 배열을 주세요.
JSON: {"candidates":["Veliko Tarnovo"]}`;
  try {
    const { value } = await generateJson(prompt, Out, { temperature: 0.1, retries: 0 });
    return json(value);
  } catch {
    return json({ candidates: [] });
  }
}
