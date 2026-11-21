import { buildPlan, PlanError } from "@/lib/server/planner";
import { json, readBody } from "@/lib/server/http";
import { TripRequestSchema } from "@/lib/schemas";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readBody(req, TripRequestSchema);
  if (body instanceof Response) return body;
  try {
    return json(await buildPlan(body));
  } catch (e) {
    if (e instanceof PlanError) {
      const status = e.kind === "blocked" ? 422 : e.kind === "ai" ? 502 : 400;
      return json({ error: e.message, kind: e.kind }, status);
    }
    console.error(e);
    return json({ error: "일정을 만드는 중 예상하지 못한 오류가 났습니다." }, 500);
  }
}
