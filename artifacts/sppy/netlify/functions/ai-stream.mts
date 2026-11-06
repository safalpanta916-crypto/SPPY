import { StreamAiCompletionBody } from "@workspace/api-zod";
import { streamCompletion, type ChatInput } from "@workspace/sppy-ai";
import {
  aiSettings,
  consumeGuestMessage,
  json,
  providerError,
} from "./_shared.mjs";
} from "../lib/shared.mjs";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The message could not be validated." }, 400);
  }
  const parsed = StreamAiCompletionBody.safeParse(body);
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

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const content of streamCompletion(
          config,
          parsed.data as ChatInput,
          abort.signal,
        )) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ content })}\n\n`),
          );
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, remainingToday: quota.remainingToday })}\n\n`,
          ),
        );
      } catch (error) {
        const safe = providerError(error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: safe.message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
