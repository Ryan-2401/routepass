import { z } from "zod";
import { json, readBody } from "@/lib/server/http";
import { CandidateSchema, LegSchema } from "@/lib/schemas";
import { verifyCandidate } from "@/lib/server/verify";
import type { Leg } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readBody(req, z.object({ leg: LegSchema, candidateId: z.string() }));
  if (body instanceof Response) return body;
  const leg = body.leg as Leg;
  const c = leg.candidates.find((x) => x.id === body.candidateId);
  if (!c) return json({ error: "후보를 찾지 못했습니다." }, 400);
  CandidateSchema.parse(c);
  return json(await verifyCandidate(leg, c));
}
