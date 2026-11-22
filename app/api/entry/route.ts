import { z } from "zod";
import { runEntryChecks } from "@/lib/entry";
import { mofaChecks } from "@/lib/server/mofa";
import { json, readBody } from "@/lib/server/http";

const Body = z.object({
  stays: z.array(z.object({ name: z.string(), country: z.string(), region: z.string().optional(), arrive: z.string(), depart: z.string() })),
  legs: z.array(z.object({ fromCountry: z.string(), toCountry: z.string(), mode: z.string() })),
  transitCountries: z.array(z.string()).default([]),
  transitDates: z.record(z.string(), z.string()).default({}),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  const checks = runEntryChecks(body.stays, body.legs, body.transitCountries, body.transitDates);
  const live = await mofaChecks([...new Set(body.stays.map((s) => s.country))]);
  return json({ checks: [...live.filter((c) => c.level === "block"), ...checks, ...live.filter((c) => c.level !== "block")] });
}
