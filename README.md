# SPPY

SPPY is the official AI platform by SPPyntex. It brings seven focused AI modes into a public, no-login workspace for learning, creating, coding, defensive cybersecurity education, research, and everyday problem-solving.

## Features

- Seven mode-specific assistants with a shared OpenAI-compatible backend.
- Incremental chat streaming, local conversation history, search, rename, delete, and clear controls.
- Browser-persisted light/dark preference and guest conversations.
- Temporary PDF, DOCX, text, CSV, Markdown, JSON, and source-code text extraction (5 MB maximum).
- Server-side daily and per-minute guest usage limits.
- Express API for the Replit development preview and Netlify Functions for deployment.
- No user account or server-side conversation database.

## Stack

- React, TypeScript, Vite, Tailwind CSS, Wouter.
- Express 5 API for the workspace preview.
- Netlify Functions (Node 22) and Netlify Blobs for production API routes and anonymous usage counters.
- OpenAI-compatible Chat Completions API. The provider service is isolated in `lib/sppy-ai`.

## Local development

Install from the workspace root:

```sh
pnpm install
```

The workspace has managed development workflows for the web app and API server. They can also be started separately:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/sppy run dev
```

The API reports a clear setup state until its server environment includes an AI key. For local non-Replit development, copy `.env.example` to an untracked `.env` file and use a server-side key. Never add a real key to GitHub or frontend variables.

## AI provider configuration

Required server-side secret (set one of these):

- `GEMINI_API_KEY` — the Google Gemini API key. Preferred for Gemini deployments.
- `AI_API_KEY` — generic provider API key. Used as a fallback if `GEMINI_API_KEY` is not set.

Set either one in Replit Secrets for the workspace preview and in Netlify environment variables for a Netlify deployment.

Optional server-side settings:

- `AI_API_BASE_URL` — OpenAI-compatible API base URL; defaults to `https://generativelanguage.googleapis.com/v1beta/openai` (Google Gemini's OpenAI-compatible endpoint).
- `AI_MODEL` — model name; defaults to `gemini-2.5-flash-lite`.
- `AI_PROVIDER_NAME` — label shown in settings/status; defaults to `Google Gemini`.
- `AI_DAILY_MESSAGE_LIMIT` — anonymous daily limit from 1 to 500; defaults to 30.

The browser never receives the provider key. Research mode does not browse the live web. Cyber mode is limited to security education and defensive help.

## Netlify deployment

The repository-root `netlify.toml` builds the SPPY web artifact, publishes `artifacts/sppy/dist/public`, routes `/api/ai/*` to serverless functions, and keeps SPA routes such as `/chat` working on refresh.

1. Push the repository to GitHub.
2. Import the repository into Netlify. Keep the repository root as the base directory so the pnpm workspace and root `netlify.toml` are used.
3. Add `GEMINI_API_KEY` in the Netlify site's environment variables. Add `AI_API_BASE_URL`, `AI_MODEL`, `AI_PROVIDER_NAME`, and `AI_DAILY_MESSAGE_LIMIT` only if changing their defaults.
4. Trigger a deploy and verify `/api/ai/status` reports the provider as configured before using chat.

The Netlify functions use Netlify Blobs to enforce anonymous per-session daily and per-minute limits across function instances. Only a hash of the browser-generated guest session ID and its counters are stored; no prompts, chat history, or file contents are stored there. A scheduled cleanup removes inactive counters after 30 days. The workspace Express preview uses in-memory counters, which reset when that server restarts.

## Privacy and data flow

- Conversations and theme preference stay in the visitor's browser until the visitor clears them or browser storage is removed.
- Messages and extracted attachment text are sent to the configured AI provider to generate responses. The provider processes that data under its own policies.
- Uploaded file bytes are held in request memory only; they are not persisted by SPPY. Extracted text may be included in a chat prompt and then follows the provider's processing and retention policies.
- Anonymous session counters are stored separately for rate limiting and never include message contents.
- SPPY does not claim that an external AI provider never processes prompts or attachments.

Review `Privacy Policy` and `Terms of Use` in the app for the visitor-facing version.

## Security notes

- Keep all API keys in server-side secrets or hosting environment variables.
- Requests are validated against the generated OpenAPI schemas. Uploads are allowlisted, size-limited, parsed in memory, and never saved to disk.
- The Cyber assistant is instructed to focus on education, authorized labs, and defensive security.
- Usage counts help control anonymous access but do not replace provider billing limits or monitoring.
