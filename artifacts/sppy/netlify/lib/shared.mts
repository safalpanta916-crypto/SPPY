import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { GetAiStatusResponse } from "../../../../lib/api-zod/src/index.ts";
import { AiProviderError, type ProviderConfig } from "../../../../lib/sppy-ai/src/index.ts";

export const MAX_DAILY_MESSAGES = 30;
const MAX_REQUESTS_PER_MINUTE = 10;
const usageStore = () => getStore("sppy-guest-usage");

interface UsageRecord {
  day: string;
  count: number;
  minuteStart: number;
  minuteCount: number;
  updatedAt: number;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function aiSettings() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.AI_API_KEY?.trim();
  const baseUrl =
    process.env.AI_API_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = process.env.AI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const rawLimit = Number.parseInt(process.env.AI_DAILY_MESSAGE_LIMIT ?? "30", 10);
  const dailyLimit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(rawLimit, 500))
    : MAX_DAILY_MESSAGES;
  const provider = process.env.AI_PROVIDER_NAME?.trim() || "Google Gemini";

  let validBaseUrl = false;
  try {
    const parsed = new URL(baseUrl);
    validBaseUrl = parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    validBaseUrl = false;
  }

  const config: ProviderConfig | null =
    apiKey && validBaseUrl ? { apiKey, baseUrl, model, provider } : null;
  return { config, model, provider, dailyLimit };
}

function sessionKey(sessionId: string): string {
  return `guest:${createHash("sha256").update(sessionId).digest("hex")}`;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function freshRecord(day: string, now: number): UsageRecord {
  return { day, count: 0, minuteStart: now, minuteCount: 0, updatedAt: now };
}

export async function getGuestUsage(sessionId: string): Promise<UsageRecord> {
  const now = Date.now();
  const day = utcDay(now);
  const current = await usageStore().get(sessionKey(sessionId), { type: "json" });
  const record = current as UsageRecord | null;
  if (!record || record.day !== day) return freshRecord(day, now);
  return record;
}

export async function consumeGuestMessage(
  sessionId: string,
  limit: number,
): Promise<
  | { allowed: true; remainingToday: number }
  | { allowed: false; status: 429 | 503; error: string; remainingToday: number }
> {
  const store = usageStore();
  const key = sessionKey(sessionId);
  const now = Date.now();
  const day = utcDay(now);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.getWithMetadata(key, {
      type: "json",
      consistency: "strong",
    });
    const previous = current?.data as UsageRecord | null;
    const record =
      !previous || previous.day !== day
        ? freshRecord(day, now)
        : { ...previous };

    if (record.count >= limit) {
      return {
        allowed: false,
        status: 429,
        error: "You’ve reached today’s message limit. Please try again tomorrow.",
        remainingToday: 0,
      };
    }
    if (now - record.minuteStart >= 60_000) {
      record.minuteStart = now;
      record.minuteCount = 0;
    }
    if (record.minuteCount >= MAX_REQUESTS_PER_MINUTE) {
      return {
        allowed: false,
        status: 429,
        error: "Please wait a moment before sending another message.",
        remainingToday: Math.max(0, limit - record.count),
      };
    }

    record.count += 1;
    record.minuteCount += 1;
    record.updatedAt = now;
let write;

if (current?.etag) {
  write = await store.setJSON(key, record, {
    onlyIfMatch: current.etag,
  });
} else if (current) {
  // Local Blobs sandbox may return an existing record without an ETag.
  // Update that record without the onlyIfNew condition.
  write = await store.setJSON(key, record);
} else {
  write = await store.setJSON(key, record, {
    onlyIfNew: true,
  });
}

console.log("[SPPY BLOBS DEBUG]", {
  attempt: attempt + 1,
  hasCurrent: Boolean(current),
  etag: current?.etag ?? null,
  modified: write.modified,
});
console.log("[SPPY BLOBS DEBUG]", {
  attempt: attempt + 1,
  hasCurrent: Boolean(current),
  etag: current?.etag ?? null,
  modified: write.modified,
});

    if (write.modified) {
      return {
        allowed: true,
        remainingToday: Math.max(0, limit - record.count),
      };
    }
  }

  return {
    allowed: false,
    status: 503,
    error: "SPPY could not check the usage limit. Please try again.",
    remainingToday: 0,
  };
}

export async function aiStatus(sessionId: string): Promise<Response> {
  const settings = aiSettings();
  const usage = await getGuestUsage(sessionId);
  const result = GetAiStatusResponse.parse({
    configured: settings.config !== null,
    provider: settings.provider,
    model: settings.model,
    dailyLimit: settings.dailyLimit,
    remainingToday: Math.max(0, settings.dailyLimit - usage.count),
  });
  return json(result);
}

export function providerError(error: unknown): { status: number; message: string } {
  if (error instanceof AiProviderError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: 503,
        message: "The AI provider rejected its server configuration. Check the server key and model settings.",
      };
    }
    if (error.status === 429) {
      return {
        status: 503,
        message: "The AI provider is busy or has reached its current limit. Please try again shortly.",
      };
    }
    return { status: 502, message: error.message };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { status: 504, message: "The AI request took too long. Please try again." };
  }
  return { status: 502, message: "SPPY could not reach the AI provider. Please try again." };
}
