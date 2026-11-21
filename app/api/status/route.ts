import { keyStatus } from "@/lib/env";

export async function GET() {
  return Response.json({ ...keyStatus(), version: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7) });
}
