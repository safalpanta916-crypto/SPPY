
import { StreamAiCompletionBody } from "../../../../lib/api-zod/src/index.ts";
import {
  streamCompletion,
  type ChatInput,
} from "../../../../lib/sppy-ai/src/index.ts";

import {
  aiSettings,
  consumeGuestMessage,
  json,
  providerError,
} from "../lib/shared.mjs";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json({ error: "The message could not be validated." }, 400);
  }

  const parsed = StreamAiCompletionBody.safeParse(body);

  if (!parsed.success) {
    return json({ error: "The message could not be validated." }, 400);
  }

  const { config, dailyLimit } = aiSettings();

  if (!config) {
    return json(
      { error: "SPPY’s AI provider needs to be configured on the server." },
      503,
    );
  }

  let quota: Awaited<ReturnType<typeof consumeGuestMessage>>;

  try {
    quota = await consumeGuestMessage(
      parsed.data.sessionId,
      dailyLimit,
    );
  } catch (error) {
    console.error("[SPPY USAGE STORAGE ERROR]", error);

    return json(
      { error: "SPPY could not check usage right now." },
      503,
    );
  }

  if (!quota.allowed) {
    return json(
      {
        error: quota.error,
        remainingToday: quota.remainingToday,
      },
      quota.status,
    );
  }

  try {
    const input = parsed.data as ChatInput;
    const stream = await streamCompletion(input, config);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[SPPY AI STREAM ERROR]", error);

    const result = providerError(error);

    return json(
      { error: result.message },
      result.status,
    );
  }
}
