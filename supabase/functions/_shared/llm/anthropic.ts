// Anthropic (Claude) adapter behind the LLM capability port (ADR-0005). Same structured-output
// contract as the Groq adapter: a FORCED tool call is how we get reliable JSON. Pure request
// builder + response parser (unit-tested offline) are separated from the network call so CI can
// verify the contract without a key. Selected per-request when the model id starts with "claude"
// (config via HANDOFF_WRITER_MODEL / HANDOFF_MECHANICAL_MODEL) — the default stays Groq.
//
// Notes:
// - Anthropic's `system` is a top-level field, not a message role, so system turns are lifted out.
// - A forced `tool_choice` is incompatible with extended thinking, so thinking is disabled for the
//   structured-output call (we want deterministic JSON, not reasoning tokens).
// - Claude's safety classifiers can return stop_reason "refusal" on a 200 — handled explicitly.
import {
  type GenerateOpts,
  LlmRateLimitError,
  LlmTerminalError,
  parseDurationMs,
  type StructuredRequest,
  withRetries,
} from "./port.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 90_000; // per ATTEMPT; writer outputs can be large, this is a background job
const DEFAULT_DEADLINE_MS = 180_000; // overall wall-clock across ALL attempts — the hang/amplification guard
const MAX_RATE_WAIT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 8192;

/** True when this request should be served by the Anthropic adapter. */
export function isAnthropicModel(model: string): boolean {
  return /^claude/i.test(model.trim());
}

/** PURE: build the Anthropic Messages body with a forced tool call = the structured result. */
export function buildAnthropicBody(req: StructuredRequest): Record<string, unknown> {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(system ? { system } : {}),
    thinking: { type: "disabled" }, // forced tool_choice is incompatible with thinking
    messages,
    tools: [
      {
        name: req.toolName,
        description: "Return your result ONLY by calling this tool with the required fields.",
        input_schema: req.schema,
      },
    ],
    tool_choice: { type: "tool", name: req.toolName },
  };
}

/** PURE: pull the forced tool_use input object out of a Messages API response. */
export function parseAnthropicToolResult(json: unknown): Record<string, unknown> {
  const j = json as { stop_reason?: string; content?: Array<{ type?: string; input?: unknown }> };
  // A safety refusal is a deterministic decision; retrying the identical request will refuse again.
  if (j?.stop_reason === "refusal")
    throw new LlmTerminalError("llm(anthropic): request was refused by safety classifiers");
  const block = Array.isArray(j?.content)
    ? j.content.find((b) => b?.type === "tool_use")
    : undefined;
  const input = block?.input;
  if (!input || typeof input !== "object") {
    // Truncated at max_tokens: the tool_use block never completed. Same budget -> same truncation,
    // so this is TERMINAL with an actionable message rather than a wasted retry.
    if (j?.stop_reason === "max_tokens")
      throw new LlmTerminalError(
        "llm(anthropic): output truncated at max_tokens (increase maxTokens)"
      );
    throw new Error("llm(anthropic): response has no tool_use input");
  }
  return input as Record<string, unknown>;
}

/** IMPURE: call Claude and return the validated structured object. Fails fast if no key. Shares
 *  the port's error-classified, deadline-bounded retry policy (withRetries) so a hung or refusing
 *  Claude call is never amplified into MAX_RETRIES x timeout. */
export async function generateStructuredAnthropic(
  req: StructuredRequest,
  opts: GenerateOpts = {}
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("llm(anthropic): ANTHROPIC_API_KEY is not configured"); // no default key
  const body = buildAnthropicBody(req);

  return withRetries(
    "llm(anthropic)",
    async (signal) => {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 529) {
        throw new LlmRateLimitError(
          Math.min(parseDurationMs(res.headers.get("retry-after")) ?? 1000, MAX_RATE_WAIT_MS)
        );
      }
      if (res.status >= 500) throw new Error(`transient HTTP ${res.status}`); // retry
      if (!res.ok)
        throw new LlmTerminalError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); // 4xx: fail fast
      const json = await res.json();
      const usage = (json as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      opts.onUsage?.({
        model: req.model,
        tokensIn: usage?.input_tokens ?? 0,
        tokensOut: usage?.output_tokens ?? 0,
      });
      return parseAnthropicToolResult(json); // may throw LlmTerminalError (refusal/truncation) or a retryable error
    },
    {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      deadlineMs: opts.deadlineMs ?? DEFAULT_DEADLINE_MS,
    }
  );
}
