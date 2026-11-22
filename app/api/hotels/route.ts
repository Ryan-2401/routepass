import { z } from "zod";
import { searchHotels } from "@/lib/server/hotels";
import { json, readBody } from "@/lib/server/http";

export const maxDuration = 60;

const Body = z.object({
  cityEn: z.string().max(100),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(10),
  lodgingClass: z.enum(["any", "hostel", "3", "4", "5"]),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (body instanceof Response) return body;
  try {
    return json(await searchHotels(body));
  } catch (e) {
    return json({ options: [], message: `실시간 숙소 검색 실패: ${(e as Error).message}` });
  }
}
