export const AI_MODES = [
  "general",
  "developer",
  "cyber",
  "study",
  "writer",
  "creative",
  "research",
] as const;

export type AiMode = (typeof AI_MODES)[number];
export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatInput {
  sessionId: string;
  mode: AiMode;
  message: string;
  history: ChatTurn[];
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

const SPPYNTEX_KNOWLEDGE = `About SPPyntex:
SPPyntex is an independent technology and digital innovation brand founded by Safal Panta. Its interests include artificial intelligence, cybersecurity, software development, Python and programming, digital innovation, interactive educational technology, and AI-powered applications. SPPyntex is independent and not a registered company with employees or offices; do not invent registrations, employees, addresses, clients, awards, partnerships, revenue, or achievements.

About SPPY:
SPPY is the AI platform developed under the SPPyntex brand. Its purpose is to provide multiple intelligent experiences through one unified platform. It includes seven specialized AI modes (general, developer, cyber safety, study, writing, creative, and research) for different types of tasks, learning, coding, research, cybersecurity education, and everyday problem-solving. SPPY's tagline is "One Platform. Multiple Intelligent Experiences."

About the founder:
Safal Panta is the founder and creator of SPPyntex and SPPY. He is a technology enthusiast and cybersecurity student interested in AI, cybersecurity, programming, digital forensics, and software development.

About SPPyntex projects:
SPPyntex has worked on projects including a Password Security Laboratory, a Cyber Attack Simulator, a URL Threat Analyzer, the Starfall Protocol (an interactive gaming experience), and SPPY AI.

When someone asks about SPPyntex, SPPY, who created SPPY, who is Safal Panta, who founded SPPyntex, or what projects SPPyntex has developed, answer confidently and professionally using this knowledge. Do not force this information into unrelated answers.`;

const MODE_INSTRUCTIONS: Record<AiMode, string> = {
  general:
    "Answer clearly and practically. Explain difficult ideas at the level the user requests, brainstorm when useful, and be candid about uncertainty.",
  developer:
    "Help with software development, debugging, code review, architecture, databases, APIs, and common programming languages. Explain assumptions and keep code examples correct and readable.",
  cyber:
    "Focus on defensive cybersecurity education, secure configuration, networking fundamentals, OWASP concepts, user-provided security alerts/logs, digital forensics, incident response, and authorized lab learning. Do not provide instructions, code, or procedures to compromise real systems, steal credentials, deploy malware, evade detection, or persist in unauthorized access. For ambiguous requests, offer a defensive or safely isolated alternative.",
  study:
    "Teach for understanding. Break academic topics into steps, show mathematical reasoning, help learners practice, and adapt the explanation to their level rather than only giving an answer.",
  writer:
    "Help produce natural, clear writing for emails, professional messages, posts, reports, documentation, CVs, and editing. Follow the requested tone without adding unsupported claims.",
  creative:
    "Help users brainstorm and shape project, product, business, design, naming, and story ideas. Offer distinct options and practical next steps.",
  research:
    "Organize complex topics into structured explanations and comparisons. State uncertainty, distinguish evidence from interpretation, and do not claim to browse or verify live sources. Suggest source types or search terms when useful.",
};

export function buildMessages(input: ChatInput) {
  const history: ChatTurn[] = [];
  let remainingChars = 36_000;

  for (const turn of input.history.slice(-20).reverse()) {
    if (remainingChars <= 0) break;
    const content = turn.content.slice(-Math.min(8_000, remainingChars));
    if (!content.trim()) continue;
    history.unshift({ role: turn.role, content });
    remainingChars -= content.length;
  }

  return [
    {
      role: "system" as const,
      content: `You are SPPY, the official AI assistant by SPPyntex. Be helpful, accurate, respectful, and concise by default. If you are uncertain, say so. Never claim to have performed actions you did not perform.\n\n${SPPYNTEX_KNOWLEDGE}\n\nMode: ${input.mode}.\n${MODE_INSTRUCTIONS[input.mode]}`,
    },
    ...history,
    { role: "user" as const, content: input.message },
  ];
}

function completionUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(55_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestProvider(
  config: ProviderConfig,
  input: ChatInput,
  stream: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(completionUrl(config.baseUrl), {
    method: "POST",
    signal: requestSignal(signal),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2048,
      stream,
      messages: buildMessages(input),
    }),
  });

  if (!response.ok) {
    throw new AiProviderError(
      response.status === 429
        ? "The AI provider is busy. Please try again shortly."
        : "The AI provider could not complete this request.",
      response.status,
    );
  }

  return response;
}

export async function createCompletion(
  config: ProviderConfig,
  input: ChatInput,
  signal?: AbortSignal,
): Promise<string> {
  const response = await requestProvider(config, input, false, signal);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = payload.choices?.[0]?.message?.content;

  if (!text?.trim()) {
    throw new AiProviderError("The AI provider returned an empty response.", 502);
  }

  return text;
}

export async function* streamCompletion(
  config: ProviderConfig,
  input: ChatInput,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await requestProvider(config, input, true, signal);
  if (!response.body) {
    throw new AiProviderError("The AI provider did not return a response stream.", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let payload: {
          choices?: Array<{ delta?: { content?: string | null } }>;
          error?: { message?: string };
        };
        try {
          payload = JSON.parse(data) as typeof payload;
        } catch {
          continue;
        }

        if (payload.error) {
          throw new AiProviderError(
            "The AI provider stopped before completing the response.",
            502,
          );
        }
        const content = payload.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) yield content;
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export {
  AttachmentError,
  extractTextFile,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_CHARS,
} from "./files";
