// 서버에서만 읽는 API 키. 키가 없으면 해당 기능은 데모/생략으로 동작합니다.
// 키는 .env.local 파일에만 넣고 GitHub에 절대 올리지 마세요.
import "server-only";

export const env = {
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
  tavilyKey: process.env.TAVILY_API_KEY || "",
  serpApiKey: process.env.SERPAPI_KEY || "",
  travelpayoutsToken: process.env.TRAVELPAYOUTS_TOKEN || "",
  dataGoKrKey: process.env.DATA_GO_KR_KEY || "",
  contactEmail: process.env.CONTACT_EMAIL || "student-project@example.com",
};

export function keyStatus() {
  return {
    gemini: !!env.geminiKey,
    tavily: !!env.tavilyKey,
    serpapi: !!env.serpApiKey,
    travelpayouts: !!env.travelpayoutsToken,
    mofa: !!env.dataGoKrKey,
    model: env.geminiModel,
  };
}
