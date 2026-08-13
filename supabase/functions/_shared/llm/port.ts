// LLM capability port (ADR-0005): the SINGLE seam every hand-off LLM call goes through.
// Provider-neutral structured-output contract with a Groq (OpenAI-compatible) adapter, reusing
// the techfleet-chat idiom: a FORCED tool call is how we get reliable JSON out. Pure request
// builders + response parser (unit-tested offline) are separate from the network call so CI can
// verify the contract without a key. Prompt-injection defense lives in the callers (system vs
// untrusted content separation) + output validation here; writer agents are given NO tools
// beyond the single structured-output tool (constrain, don't just instruct).

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export type ReasoningEffort = "low" | "medium" | "high";

// ADR-0005 defaults. gpt-oss-20b is the verified in-repo model; 120b is opt-in for writers
// once availability is confirmed. Model ids are config, not hard-coded call-site strings.
// Resolved LAZILY (functions, not top-level env reads) so importing this module needs no
// --allow-env — keeps the pure builders/parser testable in CI without permissions.
export const FALLBACK_MODEL = "openai/gpt-oss-20b";
// Production defaults (owner decision 2026-08-12): the hand-off WRITER is Opus 4.8 — chosen for the
// most natural narrative across a 6-model bake-off and confirmed against a DeepSeek A/B where DeepSeek
// was clean + ~64x cheaper but flattened research nuance. The MECHANICAL steps (fact extraction,
// source mapping) use DeepSeek v4 Flash (cheap, faithful, deterministic at temp 0). Both are served
// via OpenRouter (see DEFAULT_BASE). Baked in as CODE defaults — so a deploy uses the decided models
// even when the env secrets are unset — while HANDOFF_WRITER_MODEL / HANDOFF_MECHANICAL_MODEL still
// override per-environment. (LLM_API_KEY must be an OpenRouter key for these defaults to resolve.)
export const DEFAULT_WRITER_MODEL = "anthropic/claude-opus-4.8";
export const DEFAULT_MECHANICAL_MODEL = "deepseek/deepseek-v4-flash-0731";
// DATA RESIDENCY: the mechanical model (DeepSeek) reads the RAW uploaded material, which can contain
// personal data. DeepSeek is a Chinese company, but its open weights are also hosted by US providers.
// We pin any DeepSeek call to these US-headquartered OpenRouter providers (verified serving our model
// — a pinned call routed to CoreWeave/US) so no personal data is processed under China jurisdiction.
// The Anthropic writer is already US. Hardcoded (not env-overridable) so the residency guarantee
// cannot be silently widened by a misconfigured env var. Kept as a top-level const with NO env read,
// so importing this module still needs no --allow-env (the pure builders/parser stay testable in CI).
export const US_INFERENCE_PROVIDERS = [
  "together",
  "fireworks",
  "deepinfra",
  "baseten",
  "coreweave",
];
export function resolveWriterModel(): string {
  return Deno.env.get("HANDOFF_WRITER_MODEL") || DEFAULT_WRITER_MODEL;
}
export function resolveMechanicalModel(): string {
  return Deno.env.get("HANDOFF_MECHANICAL_MODEL") || DEFAULT_MECHANICAL_MODEL;
}

// OpenAI-compatible endpoint, provider-configurable. Default = Groq; point LLM_BASE_URL at any
// OpenAI-compatible host (OpenRouter, Together, Fireworks, OpenAI, Gemini compat) to swap
// providers with no code change. Key resolves LLM_API_KEY first, then GROQ_API_KEY (back-compat).
// Default provider = OpenRouter, which serves BOTH the Opus writer and the DeepSeek mechanical model.
// Override with LLM_BASE_URL for any other OpenAI-compatible host; LLM_API_KEY must match the host.
const DEFAULT_BASE = "https://openrouter.ai/api/v1";
export function resolveBaseUrl(): string {
  return (Deno.env.get("LLM_BASE_URL") || DEFAULT_BASE).replace(/\/+$/, "") + "/chat/completions";
}
export function resolveApiKey(): string | undefined {
  return Deno.env.get("LLM_API_KEY") || Deno.env.get("GROQ_API_KEY") || undefined;
}
const DEFAULT_TIMEOUT_MS = 90_000; // per ATTEMPT; a writer arc via OpenRouter can legitimately run ~100s
const DEFAULT_DEADLINE_MS = 180_000; // overall wall-clock across ALL attempts — the hang/amplification guard
const MAX_RETRIES = 6; // headroom to wait out 429 windows; the DEADLINE is the real bound on total time
const MAX_RATE_WAIT_MS = 30_000;

/**
 * A PERMANENT failure the caller must not retry: a 4xx client error (bad request / unsupported
 * feature / auth), output truncated at max_tokens, or a safety refusal. Retrying these cannot
 * succeed — it only burns latency and cost (every retry is a billable call) and, on a stuck
 * provider, multiplies one call into MAX_RETRIES x timeout. withRetries rethrows these immediately.
 */
export class LlmTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmTerminalError";
  }
}

/** Signals a 429 / rate-limit window: withRetries waits `waitMs` (bounded by the deadline) then retries. */
export class LlmRateLimitError extends Error {
  constructor(public readonly waitMs: number) {
    super("llm: rate limited");
    this.name = "LlmRateLimitError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** Parse a duration like "6.877s", "24m28.8s", "1200ms", or a bare seconds integer. */
export function parseDurationMs(s: string | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10) * 1000; // Retry-After in seconds
  let ms = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+\.?\d*)\s*(ms|s|m|h)/g)) {
    matched = true;
    const n = parseFloat(m[1]);
    ms += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? ms : null;
}
function rateLimitWaitMs(h: Headers): number | null {
  return (
    parseDurationMs(h.get("retry-after")) ??
    parseDurationMs(h.get("x-ratelimit-reset-tokens")) ??
    parseDurationMs(h.get("x-ratelimit-reset-requests"))
  );
}

export type StructuredRequest = {
  model: string;
  messages: LlmMessage[];
  /** Name of the forced tool = the structured result. */
  toolName: string;
  /** JSON Schema for the tool's parameters = the shape we require back. */
  schema: Record<string, unknown>;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxTokens?: number;
  /** Some providers (e.g. Gemini via OpenRouter) don't honor a forced tool call; use the
   *  json_schema response format for those instead of tools + tool_choice. */
  jsonSchemaMode?: boolean;
};

/** PURE: build the OpenAI-compatible request body. Structured output via a forced tool call
 *  (default) or a json_schema response format (jsonSchemaMode). */
export function buildStructuredBody(req: StructuredRequest): Record<string, unknown> {
  const base = {
    model: req.model,
    // Residency pin: DeepSeek calls route only to US OpenRouter providers (see US_INFERENCE_PROVIDERS).
    // `provider` is an OpenRouter routing field; non-OpenRouter hosts ignore it. allow_fallbacks stays
    // within the US allow-list, so a busy provider fails over to another US one, never to China.
    ...(req.model.includes("deepseek")
      ? { provider: { only: US_INFERENCE_PROVIDERS, allow_fallbacks: true } }
      : {}),
    ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    temperature: req.temperature ?? 0.3,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    messages: req.messages,
  };
  if (req.jsonSchemaMode) {
    return {
      ...base,
      response_format: {
        type: "json_schema",
        json_schema: { name: req.toolName, strict: true, schema: req.schema },
      },
    };
  }
  return {
    ...base,
    tools: [
      {
        type: "function",
        function: {
          name: req.toolName,
          description: "Return your result ONLY by calling this tool with the required fields.",
          parameters: req.schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: req.toolName } },
  };
}

/** Extract a JSON object from model content: unwrap a ```json fence if present, then slice from
 *  the first "{" to the last "}" so prose around the JSON (some models add it) is ignored. */
function extractJsonObject(s: string): string {
  const unfenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? s;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return (start !== -1 && end > start ? unfenced.slice(start, end + 1) : unfenced).trim();
}

/**
 * PURE: pull the structured result out of a chat-completions response. Prefers the forced
 * tool_call arguments (Groq / most OpenRouter models); falls back to parsing the message
 * content as JSON for models that return the structured output as content instead of a
 * tool_call (e.g. Gemini via OpenRouter).
 */
export function parseStructuredArguments(json: unknown): Record<string, unknown> {
  const choice = (
    json as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> };
      }>;
    }
  )?.choices?.[0];
  const msg = choice?.message;
  // finish_reason "length" means the model hit max_tokens mid-output: the tool arguments are cut off
  // (missing or invalid JSON). Retrying with the same budget truncates identically, so this is
  // TERMINAL with an actionable message — the fix is a larger maxTokens, not another attempt.
  const truncated = choice?.finish_reason === "length";
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  const raw =
    typeof args === "string"
      ? args
      : typeof msg?.content === "string"
        ? extractJsonObject(msg.content)
        : undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    if (truncated)
      throw new LlmTerminalError("llm: output truncated at max_tokens (increase maxTokens)");
    throw new Error("llm: response has no structured output");
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    if (truncated)
      throw new LlmTerminalError("llm: output truncated at max_tokens (increase maxTokens)");
    throw new Error("llm: structured output is not valid JSON");
  }
}

export type UsageMeter = (usage: { model: string; tokensIn: number; tokensOut: number }) => void;

export type GenerateOpts = {
  requestId?: string;
  timeoutMs?: number;
  deadlineMs?: number;
  onUsage?: UsageMeter;
};

function backoffMs(attempt: number): number {
  return 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
}

/**
 * The shared retry policy for every LLM call (both the OpenAI-compatible and Anthropic adapters).
 * This is the fix for the root cause: the old loops retried EVERY error MAX_RETRIES times with only
 * a per-attempt timeout, so a hung provider became MAX_RETRIES x timeout and a permanent failure
 * (4xx / truncation / refusal) burned six billable calls before giving up.
 *
 * `attempt` runs one HTTP try against the given AbortSignal and either returns the result or throws:
 *  - LlmTerminalError  -> permanent; rethrown IMMEDIATELY, no retry (fail fast).
 *  - LlmRateLimitError -> wait its window (bounded by the remaining budget) then retry.
 *  - any other error   -> transient (5xx / network / timeout); retry with backoff.
 * ALL retries are bounded by `deadlineMs` of total wall-clock, so nothing can be amplified without
 * limit, and each attempt's timeout is clamped to the budget still remaining.
 */
export async function withRetries<T>(
  label: string,
  attempt: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs: number; deadlineMs: number } = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    deadlineMs: DEFAULT_DEADLINE_MS,
  }
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  for (let i = 1; i <= MAX_RETRIES; i++) {
    const remaining = opts.deadlineMs - (Date.now() - start);
    if (remaining <= 0) break; // out of total budget
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(opts.timeoutMs, remaining));
    try {
      return await attempt(controller.signal);
    } catch (e) {
      lastErr = e;
      if (e instanceof LlmTerminalError) throw e; // permanent -> fail fast, do not retry
      const rem = opts.deadlineMs - (Date.now() - start);
      if (i >= MAX_RETRIES || rem <= 0) break;
      const wait =
        e instanceof LlmRateLimitError
          ? Math.min(e.waitMs + Math.floor(Math.random() * 300), rem)
          : Math.min(backoffMs(i), rem);
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label}: failed within ${opts.deadlineMs}ms budget: ${String(lastErr)}`);
}

/**
 * IMPURE: call the LLM and return the validated structured object. Fails fast if no key.
 * Explicit timeout on every call; capped exponential backoff + jitter on transient failure;
 * a simple failure counter lets callers open a circuit across many calls.
 */
export async function generateStructured(
  req: StructuredRequest,
  opts: GenerateOpts = {}
): Promise<Record<string, unknown>> {
  // Provider routing: Claude models go through the Anthropic adapter, everything else Groq.
  // Config-driven (HANDOFF_WRITER_MODEL / HANDOFF_MECHANICAL_MODEL); default stays Groq.
  if (/^claude/i.test(req.model.trim())) {
    const { generateStructuredAnthropic } = await import("./anthropic.ts");
    return generateStructuredAnthropic(req, opts);
  }

  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("llm: no API key (set LLM_API_KEY or GROQ_API_KEY)"); // fail fast
  const url = resolveBaseUrl();
  // OpenRouter courtesy headers (harmless on other hosts); only sent when configured.
  const referer = Deno.env.get("LLM_HTTP_REFERER");
  const title = Deno.env.get("LLM_APP_TITLE");
  const body = buildStructuredBody(req);

  return withRetries(
    "llm",
    async (signal) => {
      const res = await fetch(url, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(referer ? { "HTTP-Referer": referer } : {}),
          ...(title ? { "X-Title": title } : {}),
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429)
        throw new LlmRateLimitError(
          Math.min(rateLimitWaitMs(res.headers) ?? 1000, MAX_RATE_WAIT_MS)
        );
      if (res.status >= 500) throw new Error(`transient HTTP ${res.status}`); // retry
      if (!res.ok)
        throw new LlmTerminalError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); // 4xx: fail fast
      const json = await res.json();
      const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
        .usage;
      opts.onUsage?.({
        model: req.model,
        tokensIn: usage?.prompt_tokens ?? 0,
        tokensOut: usage?.completion_tokens ?? 0,
      });
      return parseStructuredArguments(json); // may throw LlmTerminalError (truncation) or a retryable parse error
    },
    {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      deadlineMs: opts.deadlineMs ?? DEFAULT_DEADLINE_MS,
    }
  );
}
