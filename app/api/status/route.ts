import { keyStatus } from "@/lib/env";

export async function GET() {
  return Response.json(keyStatus());
}
