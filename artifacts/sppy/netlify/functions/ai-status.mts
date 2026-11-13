import { GetAiStatusQueryParams } from "../../../../lib/api-zod/src/index.ts";
import { aiStatus, json } from "../lib/shared.mjs";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const url = new URL(request.url);
  const parsed = GetAiStatusQueryParams.safeParse({
    sessionId: url.searchParams.get("sessionId"),
  });
  if (!parsed.success) return json({ error: "A valid guest session is required." }, 400);

  try {
    return await aiStatus(parsed.data.sessionId);
  } catch {
    return json({ error: "SPPY could not check usage right now." }, 503);
  }
}
