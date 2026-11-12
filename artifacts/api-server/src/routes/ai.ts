import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import multer from "multer";
import {
  CreateAiCompletionBody,
  CreateAiCompletionResponse,
  ExtractAiAttachmentBody,
  ExtractAiAttachmentResponse,
  GetAiStatusQueryParams,
  GetAiStatusResponse,
  StreamAiCompletionBody,
} from "@workspace/api-zod";
import {
  AiProviderError,
  AttachmentError,
  createCompletion,
  extractTextFile,
  MAX_ATTACHMENT_BYTES,
  streamCompletion,
  type ChatInput,
  type ProviderConfig,
} from "@workspace/sppy-ai";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
});

const dailyUsage = new Map<
  string,
  { day: string; count: number; minuteStart: number; minuteCount: number; touched: number }
>();
let requestsSinceCleanup = 0;

function aiSettings() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.AI_API_KEY?.trim();
  const baseUrl =
    process.env.AI_API_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = process.env.AI_MODEL?.trim() || "gemini-2.5-flash-lite";

  return {
    apiKey,
    baseUrl,
    model,
    provider: process.env.AI_PROVIDER_NAME?.trim() || "Google Gemini",
  };
}

function providerConfig(): ProviderConfig | null {
  const settings = aiSettings();
  if (!settings.apiKey) return null;
  try {
    const parsed = new URL(settings.baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    provider: settings.provider,
  };
}

function dailyLimit(): number {
  const raw = Number.parseInt(process.env.AI_DAILY_MESSAGE_LIMIT ?? "30", 10);
  return Number.isFinite(raw) ? Math.max(1, Math.min(raw, 500)) : 30;
}

function usageKey(ip: string | undefined, sessionId: string): string {
  return createHash("sha256")
    .update(`${ip ?? "unknown"}:${sessionId}`)
    .digest("hex");
}

function currentUsage(key: string) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  let entry = dailyUsage.get(key);

  if (!entry || entry.day !== day) {
    entry = { day, count: 0, minuteStart: now, minuteCount: 0, touched: now };
    dailyUsage.set(key, entry);
  } else if (now - entry.minuteStart >= 60_000) {
    entry.minuteStart = now;
    entry.minuteCount = 0;
  }

  entry.touched = now;
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup >= 250) {
    requestsSinceCleanup = 0;
    for (const [oldKey, value] of dailyUsage) {
      if (now - value.touched > 48 * 60 * 60 * 1000) dailyUsage.delete(oldKey);
    }
  }
  return entry;
}

function remainingFor(ip: string | undefined, sessionId: string): number {
  const entry = currentUsage(usageKey(ip, sessionId));
  return Math.max(0, dailyLimit() - entry.count);
}

function consumeQuota(
  ip: string | undefined,
  sessionId: string,
):
  | { allowed: true; remainingToday: number }
  | { allowed: false; status: 429 | 503; error: string; remainingToday: number } {
  const entry = currentUsage(usageKey(ip, sessionId));
  const limit = dailyLimit();

  if (entry.count >= limit) {
    return {
      allowed: false,
      status: 429,
      error: "You’ve reached today’s message limit. Please try again tomorrow.",
      remainingToday: 0,
    };
  }
  if (entry.minuteCount >= 10) {
    return {
      allowed: false,
      status: 429,
      error: "Please wait a moment before sending another message.",
      remainingToday: Math.max(0, limit - entry.count),
    };
  }

  entry.count += 1;
  entry.minuteCount += 1;
  return { allowed: true, remainingToday: Math.max(0, limit - entry.count) };
}

function safeProviderError(error: unknown): { status: number; message: string } {
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

router.get("/ai/status", (req, res): void => {
  const params = GetAiStatusQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "A valid guest session is required." });
    return;
  }

  const settings = aiSettings();
  const configured = providerConfig() !== null;
  const result = GetAiStatusResponse.parse({
    configured,
    provider: settings.provider,
    model: settings.model,
    dailyLimit: dailyLimit(),
    remainingToday: remainingFor(req.ip, params.data.sessionId),
  });
  res.json(result);
});

router.post("/ai/chat", async (req, res): Promise<void> => {
  const parsed = CreateAiCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The message could not be validated." });
    return;
  }

  const config = providerConfig();
  if (!config) {
    res.status(503).json({ error: "SPPY’s AI provider needs to be configured on the server." });
    return;
  }

  const quota = consumeQuota(req.ip, parsed.data.sessionId);
  if (!quota.allowed) {
    res.status(quota.status).json({ error: quota.error, remainingToday: quota.remainingToday });
    return;
  }

  try {
    const text = await createCompletion(config, parsed.data as ChatInput);
    res.json(CreateAiCompletionResponse.parse({ text }));
  } catch (error) {
    const safe = safeProviderError(error);
    req.log.warn({ status: safe.status }, "AI completion failed");
    res.status(safe.status).json({ error: safe.message });
  }
});

router.post("/ai/chat/stream", async (req, res): Promise<void> => {
  const parsed = StreamAiCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The message could not be validated." });
    return;
  }

  const config = providerConfig();
  if (!config) {
    res.status(503).json({ error: "SPPY’s AI provider needs to be configured on the server." });
    return;
  }

  const quota = consumeQuota(req.ip, parsed.data.sessionId);
  if (!quota.allowed) {
    res.status(quota.status).json({ error: quota.error, remainingToday: quota.remainingToday });
    return;
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    for await (const content of streamCompletion(
      config,
      parsed.data as ChatInput,
      controller.signal,
    )) {
      if (controller.signal.aborted) return;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    if (!controller.signal.aborted) {
      res.write(`data: ${JSON.stringify({ done: true, remainingToday: quota.remainingToday })}\n\n`);
      res.end();
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    const safe = safeProviderError(error);
    req.log.warn({ status: safe.status }, "AI stream failed");
    if (!res.headersSent) {
      res.status(safe.status).json({ error: safe.message });
      return;
    }
    res.write(`data: ${JSON.stringify({ error: safe.message })}\n\n`);
    res.end();
  }
});

router.post(
  "/ai/attachments",
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      const message =
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? "Files must be 5 MB or smaller."
          : "SPPY could not accept this file.";
      res.status(400).json({ error: message });
    });
  },
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Choose one file to attach." });
      return;
    }
    const fileBytes = new ArrayBuffer(req.file.buffer.byteLength);
    new Uint8Array(fileBytes).set(req.file.buffer);
    const parsed = ExtractAiAttachmentBody.safeParse({
      file: new Blob([fileBytes], { type: req.file.mimetype }),
    });
    if (!parsed.success) {
      res.status(400).json({ error: "The uploaded file could not be validated." });
      return;
    }

    try {
      const extracted = await extractTextFile(req.file.originalname, req.file.buffer);
      res.json(ExtractAiAttachmentResponse.parse(extracted));
    } catch (error) {
      if (error instanceof AttachmentError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.warn("Attachment text extraction failed");
      res.status(400).json({ error: "SPPY could not read this file." });
    }
  },
);

export default router;
