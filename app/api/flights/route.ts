import { z } from "zod";
import { gatewayInfo, ROUTES } from "@/lib/incheon";
import { haversineKm } from "@/lib/geo";
import { searchFlights } from "@/lib/server/flights";
import { json, readBody } from "@/lib/server/http";
import { PlaceSchema } from "@/lib/schemas";

export const maxDuration = 60;

const Body = z.object({
  from: PlaceSchema,
  to: PlaceSchema,
  date: z.string(),
  realtime: z.boolean().default(false),
  demo: z.boolean().default(false),
  hub: z.string().regex(/^[A-Z]{3}$/).optional(),
  part: z.enum(["a", "b"]).optional(),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  let from = body.from.airports;
  let to = body.to.airports;
  let fromCode = body.from.cityCode;
  let toCode = body.to.cityCode;
  let a = { lat: body.from.lat, lng: body.from.lng };
  let b = { lat: body.to.lat, lng: body.to.lng };
  if (body.hub) {
    const h = ROUTES.find((r) => r.iata === body.hub);
    if (!h) return json({ error: "노선표에 없는 허브입니다." }, 400);
    if (body.part === "a") {
      to = [h.iata];
      toCode = h.iata;
      b = h;
    } else {
      from = [h.iata];
      fromCode = h.iata;
      a = h;
    }
  }
  // 인천이 낀 구간인데 상대 도시가 노선표상 직항이 없으면, 예시 가격에서 직항을 빼기 위한 표시
  const touchesIcn = from.includes("ICN") || to.includes("ICN");
  const other = from.includes("ICN") ? body.to : body.from;
  const allowDirect = !touchesIcn || !!body.hub || gatewayInfo(other).hasDirect;
  return json(
    await searchFlights({ from, to, fromCode, toCode, date: body.date, realtime: body.realtime, demo: body.demo, distanceKm: haversineKm(a, b), allowDirect }),
  );
}
