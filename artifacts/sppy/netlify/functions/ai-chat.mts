import { CreateAiCompletionBody, CreateAiCompletionResponse } from "@workspace/api-zod";
import { createCompletion, type ChatInput } from "@workspace/sppy-ai";
import {
  aiSettings,
  consumeGuestMessage,
  json,
  providerError,
} from "../lib/shared.mjs";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The message could not be validated." }, 400);
  }
  const parsed = CreateAiCompletionBody.safeParse(body);
  if (!parsed.success) return json({ error: "The message could not be validated." }, 400);

  const { config, dailyLimit } = aiSettings();
  if (!config) return json({ error: "SPPY’s AI provider needs to be configured on the server." }, 503);

  let quota: Awaited<ReturnType<typeof consumeGuestMessage>>;
  try {
    quota = await consumeGuestMessage(parsed.data.sessionId, dailyLimit);
  } catch {
    return json({ error: "SPPY could not check usage right now." }, 503);
  }
  if (!quota.allowed) {
    return json(
      { error: quota.error, remainingToday: quota.remainingToday },
      quota.status,
    );
  }

  try {
    const text = await createCompletion(config, parsed.data as ChatInput);
    return json(CreateAiCompletionResponse.parse({ text }));
  } catch (error) {
    const safe = providerError(error);
    return json({ error: safe.message }, safe.status);
  }
}
