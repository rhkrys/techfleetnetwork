// @edge-public
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { createEdgeLogger } from "../_shared/logger.ts";
import { applyWaf } from "../_shared/waf.ts";
import { scrub as dlpScrub } from "../_shared/dlp.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { geminiEmbedBody, geminiEmbedUrl, parseGeminiEmbedding } from "../_shared/gemini-embed.ts";
import { buildSystemPrompt, extractSourceUrls, NO_KNOWLEDGE_DIRECTIVE } from "./prompt.ts";

const ChatBodySchema = z
  .object({
    messages: z.array(z.any()).optional(),
    conversation_id: z.string().optional(),
    client_path: z.string().optional(),
  })
  .passthrough();

const log = createEdgeLogger("techfleet-chat");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// D-17: SYSTEM_PROMPT_BASE, PRACTICAL_CONTRACT, ALIAS_MAP and the audience tone
// presets were extracted verbatim into ./prompt.ts — the single source of truth
// for Fleety's behaviour, CI token-budget gated (prompt.test.ts). The pure
// buildSystemPrompt(ctx) builder assembles them per turn.

/** Max request body (256 KB — allows for longer messages + conversation history) */
const MAX_BODY_BYTES = 256 * 1024;
/** Max messages in a single request to prevent abuse */
const MAX_MESSAGES = 50;
/** Max length per message content */
const MAX_MESSAGE_LENGTH = 20_000;
// D-11: the module-level KB cache and its alphabetical full-table fallback were
// removed. All KB access now goes through the indexed fleety_kb_semantic_search
// RPC, so there are no per-isolate full-table scans at scale.
// D-04: the web-search timeout was removed along with web search.

// ── Groq answer model (the "brain" that writes replies) ──────────────────────
// Single source of truth so the router + main generation + cost accounting can
// never drift onto different / deprecated models. `llama-3.3-70b-versatile` is
// being DEPRECATED by Groq (scheduled shutoff 2026-08-16) — the same silent-
// breakage pattern that killed retrieval when Google retired an embedding model.
// `openai/gpt-oss-20b` is Groq's cheapest current high-quality NON-Meta model
// ($0.075/$0.30 per 1M in/out — half the price of 120b) and its fastest
// (~1000 tok/s), 131k ctx. Fleety answers from CLOSED RAG data, so retrieval —
// not model size — dominates answer quality; a grounded 20B model matches 120B
// here at half the cost. Bump to `openai/gpt-oss-120b` if quality testing ever
// disagrees (one line). NOT Meta/Llama (deliberate) and NOT the deprecating one.
// It is reasoning-capable, so we pin reasoning_effort="low": Groq streams any
// reasoning on a SEPARATE `delta.reasoning` channel (never in `delta.content`,
// so the client stream stays clean) and "low" protects the p95<3s latency SLO.
const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_REASONING_EFFORT = "low";
// Groq list price for gpt-oss-20b ($/token). Used only for the soft cost meter
// (fleety_record_cost) — tune if Groq re-prices; not a correctness dependency.
const PRICE_IN_PER_TOKEN = 0.075 / 1_000_000;
const PRICE_OUT_PER_TOKEN = 0.3 / 1_000_000;

/**
 * OWASP AI: Prompt injection detection patterns.
 * Detects common prompt injection / jailbreak attempts in user messages.
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the|DAN|jailbroken|unrestricted)/i,
  /act\s+as\s+(if\s+you\s+are\s+|a\s+)?(DAN|unrestricted|unfiltered|evil)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(DAN|unrestricted|different\s+AI)/i,
  /system\s*prompt/i,
  /\[SYSTEM\]/i,
  /\<\|im_start\|/i,
  /\<\|endoftext\|/i,
  /reveal\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions?)/i,
  /what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /override\s+(safety|content|security)\s+(filter|policy|rules?)/i,
  /bypass\s+(the\s+)?(restrictions?|filters?|rules?|safety)/i,
  /do\s+anything\s+now/i,
  /jailbreak/i,
];

function hasPromptInjection(content: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((p) => p.test(content));
}

/**
 * OWASP LLM02/LLM05: Output sanitization.
 * Strips system prompt leakage, dangerous content, and PII patterns.
 */
const CANARY_PHRASE = "FLEETY-SYSTEM-CANARY-7x9k2";

/** Common PII patterns to redact from AI output (LLM02: Sensitive Info Disclosure) */
const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, // emails
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // US phone numbers
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // credit cards
];

function sanitizeAIOutput(text: string): string {
  let sanitized = text
    // LLM07: Strip system prompt markers / canary
    .replace(/\<\|im_start\|[^]*?\<\|im_end\|>/g, "")
    .replace(/\[SYSTEM\][^]*/gi, "")
    .replace(new RegExp(CANARY_PHRASE, "g"), "[REDACTED]")
    // LLM05: Strip dangerous HTML/JS from output
    // Use \b + tolerant closing tag so <script/>, <script >, </script > etc. are all caught.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<iframe\b[^>]*\/?>/gi, "")
    // Also strip unquoted event handlers: onclick=alert(1) as well as onclick="..."
    .replace(/on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // LLM02: Redact PII patterns from AI output
  for (const pattern of PII_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  // Defense-in-depth: also run the shared DLP scrubber. This catches
  // tokens, JWTs, SB/Stripe keys, hex tokens, and CC-shape numbers that
  // the local PII_PATTERNS list doesn't cover. Belt + suspenders.
  sanitized = dlpScrub(sanitized);

  return sanitized;
}

// D-04: the web-search trigger heuristics and the trusted-domain list were
// removed. Fleety answers only from Tech Fleet's own knowledge sources.

/**
 * Generate a 768-dim embedding for the user's query via Gemini
 * gemini-embedding-001 (the single embedding model across Fleety, D-01, defined
 * in _shared/gemini-embed.ts). No external-gateway fallback (D-04). Returns null
 * on failure so callers can
 * degrade to trigram retrieval (UC-22).
 */
// EMBED_DIM lives in _shared/gemini-embed.ts (GEMINI_EMBED_DIM) now — one source
// of truth for the model + dimension across the query and ingest paths.
async function embedQuery(text: string, requestId: string): Promise<number[] | null> {
  const trimmed = (text || "").slice(0, 4000);
  if (!trimmed.trim()) return null;
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
  if (!GEMINI_API_KEY) return null;
  try {
    const r = await fetch(geminiEmbedUrl(GEMINI_API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiEmbedBody(trimmed, "RETRIEVAL_QUERY")),
    });
    if (!r.ok) {
      // Log a snippet of the error body — a bare status code hid a retired-model
      // HTTP 404 (text-embedding-004) for weeks. The body names the real cause.
      let detail = "";
      try {
        detail = (await r.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      log.warn("embed", `Gemini embed HTTP ${r.status} [${requestId}]: ${detail}`, {
        requestId,
      });
      return null;
    }
    return parseGeminiEmbedding(await r.json());
  } catch (e) {
    log.warn(
      "embed",
      `embedQuery failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
      { requestId }
    );
    return null;
  }
}

function vecLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build an SSE ReadableStream that replays cached markdown to the client in
 * the same OpenAI-compatible delta format the AI gateway uses, so the
 * Fleety widget renders cache hits with its existing streaming animation.
 * Cuts each response into ~24-char chunks with tiny inter-chunk delays so
 * the user sees the typing cadence rather than a single instant flush.
 */
function buildCacheSSEStream(markdown: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const CHUNK = 24;
  const chunks: string[] = [];
  for (let i = 0; i < markdown.length; i += CHUNK) {
    chunks.push(markdown.slice(i, i + CHUNK));
  }
  let idx = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (idx >= chunks.length) {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      const payload = {
        choices: [{ delta: { content: chunks[idx] } }],
      };
      controller.enqueue(enc.encode("data: " + JSON.stringify(payload) + "\n\n"));
      idx++;
      // Tiny breath so the frontend animates rather than instant-renders.
      await new Promise((r) => setTimeout(r, 8));
    },
  });
}

/**
 * Cheap intent classifier — regex-first to keep latency / cost at zero
 * for the 95% of cases we recognize. Returns one of:
 *   definition | how_to | troubleshoot | decision | reference
 * Theory contract is used only for `definition` and `reference`. All
 * others trigger PRACTICAL_CONTRACT, playbook retrieval, and action chips.
 */
type Intent = "definition" | "how_to" | "troubleshoot" | "decision" | "reference";

const INTENT_RULES: Array<{ intent: Intent; pattern: RegExp }> = [
  {
    intent: "troubleshoot",
    pattern:
      /\b(stuck|blocked|broken|not working|fail(ed|ing)?|error|bug|help|can't|cannot|won't|doesn't|debug|fix)\b/i,
  },
  {
    intent: "decision",
    pattern:
      /\b(should i|which (one|should)|vs\.?\b|versus|better|recommend|choose|decide|trade.?off)\b/i,
  },
  {
    intent: "how_to",
    pattern:
      /\b(how (do|to|can|should|would)|steps?\s+to|guide (to|for)|walk me through|run a|conduct a|facilitate|prepare|write a|draft|create a|build a|set up|next step|what (do|should) i)\b/i,
  },
  {
    intent: "reference",
    pattern:
      /\b(list (of|all)|what are the|show me (all|the)|where (is|are)|find (me|the)|where can i)\b/i,
  },
  {
    intent: "definition",
    pattern: /\b(what is|what's|define|definition|meaning of|who is|explain (the|what))\b/i,
  },
];

function classifyIntent(userMessage: string): Intent {
  for (const r of INTENT_RULES) if (r.pattern.test(userMessage)) return r.intent;
  // Default: treat as how_to so we lean practical, not theoretical.
  return "how_to";
}

function isOperationalIntent(i: Intent): boolean {
  return i === "how_to" || i === "troubleshoot" || i === "decision";
}

/**
 * Stage-1 router: a Groq (GROQ_MODEL) forced tool call returning structured
 * intent. Runs in parallel with embedding so it adds zero serial latency.
 * Silently falls back to regex (classifyIntent) on any failure. The web-search
 * decision fields are vestigial — web search was removed (D-04) and is ignored.
 */
type RouterDecision = { intent: Intent; needsWeb: boolean; webQuery: string | null };
async function routeWithModel(
  userMessage: string,
  requestId: string
): Promise<RouterDecision | null> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        reasoning_effort: GROQ_REASONING_EFFORT,
        messages: [
          {
            role: "system",
            content:
              "You route user questions for a coaching assistant. Reply only via the route tool.",
          },
          { role: "user", content: userMessage.slice(0, 1000) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "route",
              description: "Classify intent and decide if web search is needed.",
              parameters: {
                type: "object",
                properties: {
                  intent: {
                    type: "string",
                    enum: ["definition", "how_to", "troubleshoot", "decision", "reference"],
                  },
                  needs_web: {
                    type: "boolean",
                    description:
                      "True only if the answer requires fresh external info (current events, prices, news, library API specifics) AND can't be answered from internal training framework knowledge.",
                  },
                  web_query: {
                    type: "string",
                    description: "Concise search query (3-8 words). Empty if needs_web is false.",
                  },
                },
                required: ["intent", "needs_web", "web_query"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "route" } },
      }),
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    const parsed = JSON.parse(args);
    return {
      intent: parsed.intent as Intent,
      needsWeb: !!parsed.needs_web,
      webQuery: parsed.web_query || null,
    };
  } catch (e) {
    console.warn(`[${requestId}] router model failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// D-04: the web-search helper functions were removed. Fleety answers
// exclusively from Tech Fleet's own knowledge sources.

serve(
  withAuditWrapper("techfleet-chat", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // WAF: rate-limit / oversize / scanner / SQLi protection. Logged to
    // security_events for the weekly admin digest.
    const blocked = await applyWaf(req, "techfleet-chat");
    if (blocked) return blocked;

    // WSTG-CONF-06: Only allow POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
      });
    }

    const requestId = crypto.randomUUID().substring(0, 8);
    log.info("handler", `Chat request received [${requestId}]`, { requestId });

    try {
      // ── WSTG-ATHZ-01: JWT Authentication ──────────────────────────────
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SUPABASE_ANON_KEY =
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });

      const {
        data: { user },
        error: authError,
      } = await authClient.auth.getUser();
      if (authError || !user) {
        log.warn("auth", `Authentication failed [${requestId}]`, { requestId });
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      log.info("auth", `Authenticated user [${requestId}]`, { requestId, userId: user.id });

      // ── Payload size check ────────────────────────────────────────────
      const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_BODY_BYTES) {
        log.warn("handler", `Request body too large [${requestId}]: ${contentLength} bytes`, {
          requestId,
          contentLength,
        });
        return new Response(JSON.stringify({ error: "Request body too large" }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const _rawChat = await req.json().catch(() => ({}));
      const _parsedChat = ChatBodySchema.safeParse(_rawChat);
      if (!_parsedChat.success) {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { messages, conversation_id, client_path } = _parsedChat.data as {
        messages?: any[];
        conversation_id?: string;
        client_path?: string;
      };
      const safeClientPath =
        typeof client_path === "string"
          ? client_path.replace(/[^A-Za-z0-9/_\-?=&.]/g, "").slice(0, 200)
          : "";

      if (!Array.isArray(messages) || messages.length === 0) {
        return new Response(JSON.stringify({ error: "messages must be a non-empty array" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (messages.length > MAX_MESSAGES) {
        log.warn("handler", `Too many messages [${requestId}]: ${messages.length}`, { requestId });
        return new Response(
          JSON.stringify({ error: `Maximum ${MAX_MESSAGES} messages allowed per request` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validRoles = new Set(["user", "assistant", "system"]);
      for (const msg of messages) {
        if (!msg.role || !validRoles.has(msg.role)) {
          return new Response(JSON.stringify({ error: "Invalid message role" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (typeof msg.content !== "string" || msg.content.length > MAX_MESSAGE_LENGTH) {
          return new Response(
            JSON.stringify({
              error: `Message content must be a string under ${MAX_MESSAGE_LENGTH} characters`,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ── OWASP AI: Prompt injection detection ──────────────────────────
      const lastUserMessage =
        messages.filter((m: { role: string }) => m.role === "user").pop()?.content || "";

      if (hasPromptInjection(lastUserMessage)) {
        log.warn("prompt-injection", `Potential prompt injection detected [${requestId}]`, {
          requestId,
          userId: user.id,
          snippet: lastUserMessage.substring(0, 80),
        });
        // Don't block — but add a defense instruction to the system prompt
        // This is the "defense in depth" approach recommended by OWASP AI Exchange
      }

      // Strip any injected system-role messages from user input
      const sanitizedMessages = messages.filter((m: { role: string }) => m.role !== "system");

      log.info("chat", `Processing ${sanitizedMessages.length} messages [${requestId}]`, {
        requestId,
        messageCount: sanitizedMessages.length,
        lastUserMessage: lastUserMessage.substring(0, 100),
      });

      const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
      if (!GROQ_API_KEY) {
        log.error("config", `GROQ_API_KEY is not configured [${requestId}]`, { requestId });
        return new Response(JSON.stringify({ error: "AI service is not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // ── L1: Per-user soft quota (Cost Plan v2) ────────────────────────
      // Caps abusive/runaway usage at 30 turns/day and 150 turns/month so a
      // viral spike from a tiny number of power users can't blow the AI
      // budget. Friendly, helpful redirect — never a dead end.
      try {
        const { data: q, error: qErr } = await supabase.rpc("check_fleety_user_quota", {
          _user_id: user.id,
        });
        const row = Array.isArray(q) ? q[0] : q;
        if (!qErr && row && row.allowed === false) {
          log.info("quota", `User quota reached [${requestId}] reason=${row.reason}`, {
            requestId,
            userId: user.id,
            reason: row.reason,
            dailyUsed: row.daily_used,
            monthlyUsed: row.monthly_used,
          });
          const friendly =
            row.reason === "monthly_cap"
              ? "You've reached your Fleety chat limit for this month. Try the search bar at the top, browse the Knowledge Base, or book office hours — and I'll be back next month."
              : "You've hit today's Fleety chat limit. Try the search bar at the top, browse the Knowledge Base, or book office hours — I'll reset overnight.";
          return new Response(
            JSON.stringify({
              error: friendly,
              quota: {
                reason: row.reason,
                daily_used: row.daily_used,
                daily_limit: row.daily_limit,
                monthly_used: row.monthly_used,
                monthly_limit: row.monthly_limit,
              },
            }),
            {
              status: 429,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Retry-After": row.reason === "daily_cap" ? "3600" : "86400",
              },
            }
          );
        }
      } catch (e) {
        log.warn(
          "quota",
          `quota check failed open [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
          { requestId }
        );
      }

      // ── Server-side shared chatbot rate limiting (WSTG-BUSL-05) ────────
      const { data: rateLimitResult, error: rateLimitError } = await supabase.rpc(
        "check_chat_system_rate_limit"
      );

      if (rateLimitError) {
        log.error(
          "rate-limit",
          `Chat rate-limit check failed open [${requestId}]: ${rateLimitError.message}`,
          {
            requestId,
            userId: user.id,
          },
          rateLimitError
        );
      }

      if (rateLimitResult && !rateLimitResult.allowed) {
        log.warn("rate-limit", `System chat rate limit exceeded [${requestId}]`, {
          requestId,
          userId: user.id,
          retryAfter: rateLimitResult.retry_after,
          limit: rateLimitResult.limit,
        });
        return new Response(
          JSON.stringify({
            error:
              "Too many chat requests across the system. Please try again after the hourly reset.",
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Retry-After": String(rateLimitResult.retry_after || 3600),
            },
          }
        );
      }

      // ── Cost guard step (Cost Plan v2 §7) ─────────────────────────────
      // Cheap RPC; never blocks. Returns 'none' | 'soft' | 'medium' | 'hard'.
      let costGuardStep: "none" | "soft" | "medium" | "hard" = "none";
      try {
        const { data: gs } = await supabase.rpc("fleety_cost_guard_step");
        if (typeof gs === "string" && ["none", "soft", "medium", "hard"].includes(gs)) {
          costGuardStep = gs as "none" | "soft" | "medium" | "hard";
        }
      } catch (_) {
        /* fail-open */
      }

      // Stage-1 router runs in parallel with the query embedding (zero added serial latency).
      const [queryEmbedding, routerDecision] = await Promise.all([
        embedQuery(lastUserMessage, requestId),
        routeWithModel(lastUserMessage, requestId),
      ]);
      const haveEmbeddings = !!queryEmbedding;

      // ── Early audience detection (needed by L3 cache key) ─────────────
      let audience: "member" | "teacher" | "admin" = "member";
      try {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);
        const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
        if (set.has("admin")) audience = "admin";
        else if (set.has("teacher")) audience = "teacher";
      } catch (_) {
        /* default member */
      }

      // ── L3: Semantic response cache (Cost Plan v2) ───────────────────
      // If we have embeddings and a near-duplicate question was answered for
      // this audience+kb_version within 7 days, replay the stored markdown as
      // a synthetic SSE stream — zero AI gateway call, identical UX.
      if (haveEmbeddings) {
        try {
          const { data: hit } = await supabase.rpc("fleety_cache_semantic_lookup", {
            _query_embedding: vecLiteral(queryEmbedding!) as unknown as number[],
            _audience: audience,
            _max_distance: costGuardStep === "none" ? 0.05 : 0.08,
          });
          const cached = Array.isArray(hit) ? hit[0] : hit;
          if (cached && typeof cached.response_md === "string" && cached.response_md.length > 10) {
            // Record a turn signal so admin dashboards still see the volume.
            let cacheTurnId: string | null = null;
            try {
              const { data: sig } = await supabase
                .from("fleety_turn_signals")
                .insert({
                  conversation_id: conversation_id ?? null,
                  user_id: user.id,
                  user_query: lastUserMessage.slice(0, 2000),
                  audience,
                  kb_hit_count: 0,
                  framework_hit_count: 0,
                  web_hit_count: 0,
                  intent: routerDecision?.intent ?? "definition",
                  prompt_version: "cache-hit",
                })
                .select("id")
                .single();
              cacheTurnId = sig?.id ?? null;
            } catch (_) {
              /* ok */
            }

            // Bump hit count + cost counter (near-zero $, but track it)
            supabase
              .rpc("fleety_cache_record_hit", {
                _query_hash: cached.query_hash,
                _turn_id: cacheTurnId,
              })
              .then(
                () => {},
                () => {}
              );
            supabase
              .rpc("fleety_record_cost", {
                _model: "cache",
                _tier: cached.tier ?? "B",
                _tokens_in: 0,
                _tokens_out: 0,
                _est_usd: 0.00005,
                _cache_hit: true,
                _canned_hit: false,
              })
              .then(
                () => {},
                () => {}
              );

            log.info(
              "cache",
              `L3 cache HIT [${requestId}] hash=${String(cached.query_hash).slice(0, 8)} sim=${cached.similarity?.toFixed?.(3) ?? "?"}`,
              { requestId }
            );

            const headers: Record<string, string> = {
              ...corsHeaders,
              "Access-Control-Expose-Headers": "X-Fleety-Turn-Id, X-Fleety-Cache, X-Fleety-Intent",
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "X-Fleety-Cache": "hit",
              "X-Fleety-Intent": routerDecision?.intent ?? "definition",
            };
            if (cacheTurnId) headers["X-Fleety-Turn-Id"] = cacheTurnId;

            return new Response(buildCacheSSEStream(cached.response_md), { headers });
          }
        } catch (e) {
          log.warn(
            "cache",
            `L3 cache lookup failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
            { requestId }
          );
        }
      }

      // Load knowledge base via semantic top-K. (Web search removed — D-04.)

      // Lean RAG (Cost Plan v2 §5): tighter KB context. Was 12×2000/60000.
      // Quality preserved by semantic top-K + framework graph + few-shot still
      // injected below. Long/complex turns get extra room via Tier C in Phase 2.
      // Cost guard tightens RAG budget: soft 6→5, medium 6→4, hard 6→3.
      const KB_TOPK =
        costGuardStep === "hard"
          ? 3
          : costGuardStep === "medium"
            ? 4
            : costGuardStep === "soft"
              ? 5
              : 6;
      const PER_KB_CHARS = costGuardStep === "none" ? 1_200 : 900;
      const MAX_KB_CONTEXT_CHARS = costGuardStep === "none" ? 18_000 : 12_000;

      type KbHit = { title: string; url: string; content: string };
      let kbHits: KbHit[] = [];

      if (haveEmbeddings) {
        try {
          const { data, error } = await supabase.rpc("fleety_kb_semantic_search", {
            p_query_embedding: vecLiteral(queryEmbedding!) as unknown as number[],
            p_limit: KB_TOPK,
          });
          if (error) throw error;
          kbHits = (data ?? []) as KbHit[];
        } catch (e) {
          log.warn(
            "kb",
            `semantic KB failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
            { requestId }
          );
        }
      }

      // D-11: no full-table fallback. If semantic search returns nothing, kbHits
      // stays empty and the honest "no knowledge available" path below handles it
      // (a trigram fallback for embedding outages is tracked separately — UC-22).

      // D-04: web search removed. webResult kept as an empty shape so downstream
      // logging and turn-signal counts stay valid without further edits.
      const webResult: { context: string; sources: { title: string; url: string }[] } = {
        context: "",
        sources: [],
      };

      log.info(
        "kb",
        `Using ${kbHits.length} KB entries [${requestId}] (semantic=${haveEmbeddings})`,
        { requestId }
      );

      let knowledgeContext = "";
      if (kbHits.length > 0) {
        for (const entry of kbHits) {
          const cap = PER_KB_CHARS;
          const truncated =
            entry.content.length > cap
              ? entry.content.substring(0, cap) + "...[truncated]"
              : entry.content;
          const block = `\n---\nSOURCE: ${entry.title} (${entry.url})\n${truncated}\n`;
          if (knowledgeContext.length + block.length > MAX_KB_CONTEXT_CHARS) break;
          knowledgeContext += block;
        }
      }
      // UC-04: no fake "knowledge base is being set up" text. When retrieval
      // genuinely returned nothing, knowledgeContext stays "" and the honesty
      // directive is injected below once all context sources are known.

      // ── Framework graph injection ─────────────────────────────────────
      // Pull top-N framework nodes matching the user's query and append
      // their full deduplicated neighborhood to the system context. Lets
      // Fleety answer relationship questions ("who do I work with as a UX
      // researcher in an agency?") in a single LLM round-trip.
      let frameworkContext = "";
      const MAX_NEIGHBORS_PER_DIR = 12; // was 20
      const MAX_FRAMEWORK_CONTEXT_BYTES = 8_000; // ~2k tokens hard cap (was 6k)
      try {
        const { data: hits } = await supabase.rpc("search_framework", {
          p_query: lastUserMessage.slice(0, 500),
          p_limit: 8,
        });
        if (Array.isArray(hits) && hits.length > 0) {
          const sections: string[] = [
            "\n\nFRAMEWORK GRAPH (authoritative relationships from the Skills & Practices Framework):",
          ];
          let totalBytes = sections[0].length;

          // ─── Verbatim PDF relationship sentences ───────────────
          // Build distinct unordered entity-type pairs from the search hits;
          // ask DB for the curator-authored sentences (description +
          // inverse_description). Quote those verbatim so Fleety never has
          // to invent phrasing for "skills ↔ deliverables" style questions.
          const typedHits = hits as Array<{ entity_type: string; id: string; name: string }>;
          const pairSet = new Set<string>();
          const pairs: Array<{ a: string; b: string }> = [];
          for (let i = 0; i < typedHits.length; i++) {
            for (let j = i + 1; j < typedHits.length; j++) {
              const a = typedHits[i].entity_type;
              const b = typedHits[j].entity_type;
              if (a === b) continue;
              const k = a < b ? `${a}|${b}` : `${b}|${a}`;
              if (pairSet.has(k)) continue;
              pairSet.add(k);
              pairs.push({ a, b });
            }
          }
          if (pairs.length > 0) {
            const { data: relRows, error: relErr } = await supabase.rpc("fw_lookup_relationships", {
              p_pairs: pairs,
            });
            if (relErr) {
              log.warn(
                "framework",
                `fw_lookup_relationships failed [${requestId}]: ${relErr.message}`,
                { requestId }
              );
            }
            const rows = (relRows ?? []) as Array<{
              a: string;
              b: string;
              forward: string;
              inverse: string | null;
            }>;
            if (rows.length > 0) {
              const verbatim: string[] = [
                "\nREFERENCE RELATIONSHIP SENTENCES (these are the canonical meanings — preserve the entity names and the relationship verb exactly, but REPHRASE the sentence in your own conversational Fleety voice; do NOT paste them verbatim):",
              ];
              for (const r of rows) {
                verbatim.push(`  • ${r.a} → ${r.b}: "${r.forward}"`);
                if (r.inverse && r.inverse.trim().length > 0) {
                  verbatim.push(`  • ${r.b} → ${r.a}: "${r.inverse}"`);
                }
              }
              const block = verbatim.join("\n") + "\n";
              sections.push(block);
              totalBytes += block.length;
            }
          }

          // Single batched RPC replaces N parallel get_node_neighbors calls.
          // Cuts DB round-trips from ~8 → 1 per chat turn.
          const { data: batchData, error: batchErr } = await supabase.rpc(
            "get_nodes_neighbors_batch",
            { p_nodes: typedHits.map((h) => ({ type: h.entity_type, id: h.id })) }
          );
          if (batchErr) {
            log.warn(
              "framework",
              `get_nodes_neighbors_batch failed [${requestId}]: ${batchErr.message}`,
              { requestId }
            );
          }
          const batchMap = (batchData ?? {}) as Record<
            string,
            {
              outgoing?: Array<{ rel: string; type: string; name: string }>;
              incoming?: Array<{ rel: string; type: string; name: string }>;
            }
          >;
          const neighborResults = typedHits.map((hit) => ({
            hit,
            data: batchMap[`${hit.entity_type}:${hit.id}`] ?? { outgoing: [], incoming: [] },
            error: null as { message?: string } | null,
          }));
          // ── Bidirectional natural-language label map ──────────────────
          // Each rel_type is stored once (directed) in framework_edges, but
          // Fleety must describe both directions in plain, human phrasing
          // (per the Skills & Practices Framework PDF). The forward label
          // applies when the searched node is the SOURCE of the edge; the
          // inverse label applies when it is the TARGET. Cardinality hints
          // ("one-to-many", "many-to-many") match the PDF wording so the
          // LLM can quote them verbatim instead of inventing phrasing.
          type RelLabel = { forward: string; inverse: string };
          const REL_LABELS: Record<string, RelLabel> = {
            produces: {
              forward: "produces (one-to-many) deliverables",
              inverse:
                "is produced by — requires one-to-many Technical and Interpersonal Skills to complete",
            },
            requires_skill: {
              forward: "requires (one-to-many) Technical and Interpersonal Skills",
              inverse:
                "is required by (one-to-many) deliverables/activities — these skills enable completion",
            },
            requires_activity: {
              forward: "requires (one-to-many) activities to complete",
              inverse:
                "is required by (one-to-many) deliverables — this activity contributes to completing them",
            },
            uses_tool: {
              forward: "uses (one-to-many) tools",
              inverse: "is used by (one-to-many) activities/deliverables as a tool",
            },
            uses_practice: {
              forward: "applies (one-to-many) Team Practices",
              inverse: "is applied by (one-to-many) duties/activities as a Team Practice",
            },
            performed_by: {
              forward: "is performed by (one-to-many) duties/job titles",
              inverse: "performs (one-to-many) activities/deliverables",
            },
            teaches_skill: {
              forward: "teaches (one-to-many) Technical and Interpersonal Skills",
              inverse: "is taught by (one-to-many) workshops/learning experiences",
            },
            part_of: {
              forward: "is part of",
              inverse: "contains (one-to-many)",
            },
            targets_company_type: {
              forward: "targets (one-to-many) company types",
              inverse: "is targeted by (one-to-many) duties/activities",
            },
            engages_stakeholder: {
              forward: "engages (one-to-many) stakeholders",
              inverse: "is engaged by (one-to-many) duties/activities",
            },
            related_to: {
              forward: "is related to",
              inverse: "is related to",
            },
          };
          const labelFor = (rel: string, dir: "forward" | "inverse"): string =>
            REL_LABELS[rel]?.[dir] ?? (dir === "forward" ? rel : `is ${rel} by`);

          for (const { hit, data: neighbors, error: nErr } of neighborResults) {
            if (nErr) {
              log.warn(
                "framework",
                `get_node_neighbors failed for ${hit.entity_type}/${hit.id} [${requestId}]: ${nErr.message}`,
                { requestId }
              );
              continue;
            }
            const n = (neighbors ?? {}) as {
              outgoing?: Array<{ rel: string; type: string; name: string }>;
              incoming?: Array<{ rel: string; type: string; name: string }>;
            };
            // Group by relation, cap per direction, format with bidirectional
            // human-readable labels so the LLM never has to guess inverse phrasing.
            const fmtGroup = (
              edges: Array<{ rel: string; type: string; name: string }> | undefined,
              dir: "forward" | "inverse"
            ): string => {
              if (!Array.isArray(edges) || edges.length === 0) return "";
              const byRel = new Map<string, string[]>();
              for (const e of edges.slice(0, MAX_NEIGHBORS_PER_DIR)) {
                const list = byRel.get(e.rel) ?? [];
                if (list.length < MAX_NEIGHBORS_PER_DIR) list.push(e.name);
                byRel.set(e.rel, list);
              }
              const lines: string[] = [];
              for (const [rel, names] of byRel) {
                const totalForRel = edges.filter((x) => x.rel === rel).length;
                const truncated =
                  totalForRel > names.length ? ` (+${totalForRel - names.length} more)` : "";
                lines.push(
                  `  • ${hit.name} ${labelFor(rel, dir)}: ${names.join(", ")}${truncated}`
                );
              }
              return lines.join("\n");
            };
            const out = fmtGroup(n.outgoing, "forward");
            const inc = fmtGroup(n.incoming, "inverse");
            if (!out && !inc) continue;
            const block = `\n▸ ${hit.name} (${hit.entity_type}) — both directions:\n${[out, inc].filter(Boolean).join("\n")}\n`;
            if (totalBytes + block.length > MAX_FRAMEWORK_CONTEXT_BYTES) {
              sections.push("\n[…additional framework matches truncated to fit context budget]");
              break;
            }
            sections.push(block);
            totalBytes += block.length;
          }
          if (sections.length > 1) frameworkContext = sections.join("");
        }
      } catch (e) {
        log.warn(
          "framework",
          `framework graph injection failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
          { requestId }
        );
      }

      // Terminology alias map + audience tone preset now live in prompt.ts and
      // are injected by buildSystemPrompt. (Audience already detected above for
      // the L3 cache key.)

      // ── Canned answers (curator-approved) — highest priority ──────────
      let cannedContext = "";
      let cannedAnswerId: string | null = null;
      try {
        const { data: canned } = await supabase.rpc("fleety_match_canned_answers", {
          p_query: lastUserMessage.slice(0, 500),
          p_audience: audience,
          p_limit: 1,
        });
        const top = (canned ?? [])[0] as
          { id: string; answer_md: string; similarity: number } | undefined;
        if (top && top.similarity >= 0.45) {
          cannedAnswerId = top.id;
          cannedContext = `\n\nCURATED ANSWER (admin-approved — start from this exact content; you may lightly tailor wording but must preserve every fact and link):\n${top.answer_md}\n`;
          // Wave 1 COST-W1-014: high-confidence canned hit short-circuits the
          // LLM call — stream the curated answer directly via the cache SSE
          // builder, same shape as an L3 cache hit.
          if (top.similarity >= 0.75) {
            supabase
              .rpc("fleety_record_cost", {
                _model: "canned",
                _tier: "B",
                _tokens_in: 0,
                _tokens_out: 0,
                _est_usd: 0.00005,
                _cache_hit: false,
                _canned_hit: true,
              })
              .then(
                () => {},
                () => {}
              );
            const headers: Record<string, string> = {
              ...corsHeaders,
              "Access-Control-Expose-Headers":
                "X-Fleety-Turn-Id, X-Fleety-Cache, X-Fleety-Intent, X-Fleety-Canned",
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "X-Fleety-Canned": "hit",
              "X-Fleety-Intent": routerDecision?.intent ?? "definition",
            };
            return new Response(buildCacheSSEStream(top.answer_md), { headers });
          }
        }
      } catch (e) {
        log.warn(
          "canned",
          `canned answer lookup failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
          { requestId }
        );
      }

      // ── Few-shot examples from highly-rated past Q&A ──────────────────
      let fewShotContext = "";
      try {
        const { data: shots } = await supabase.rpc("fleety_few_shot_examples", {
          p_query: lastUserMessage.slice(0, 500),
          p_limit: 3,
        });
        const rows = (shots ?? []) as Array<{ user_query: string; assistant_response: string }>;
        const usable = rows.filter((r) => r.assistant_response && r.assistant_response.length > 40);
        if (usable.length > 0) {
          fewShotContext =
            "\n\nEXAMPLES OF GREAT ANSWERS (past responses that earned a thumbs-up — match this tone, depth, and structure):\n" +
            usable
              .map(
                (r, i) =>
                  `\n[Example ${i + 1}]\nUser: ${r.user_query}\nFleety: ${r.assistant_response.slice(0, 1500)}`
              )
              .join("\n");
        }
      } catch (e) {
        log.warn(
          "fewshot",
          `few-shot lookup failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
          { requestId }
        );
      }

      // ── Intent classification + practical-mode retrieval ─────────────
      const intent: Intent = routerDecision?.intent ?? classifyIntent(lastUserMessage);
      const practical = isOperationalIntent(intent);
      log.info("intent", `Detected intent=${intent} practical=${practical} [${requestId}]`, {
        requestId,
        intent,
      });

      let playbookContext = "";
      let exampleContext = "";
      let actionChips: Array<{ label: string; action_type: string; target_url?: string | null }> =
        [];
      let playbookHits = 0;
      let exampleHits = 0;
      let topPlaybookSlug: string | null = null;

      if (practical) {
        type PbRow = {
          slug: string;
          title: string;
          intent: string;
          direct_answer: string;
          steps: unknown;
          done_criteria: string[];
          common_pitfalls: string[];
          ask_for_help: string | null;
          example_artifact_url: string | null;
          action_chips: unknown;
          similarity: number;
        };
        let pbRows: PbRow[] = [];

        // Tier 1: semantic match (cosine ≥ 0.55 ≈ similarity ≥ 0.55 since 1 - dist)
        if (haveEmbeddings) {
          try {
            const { data } = await supabase.rpc("fleety_match_playbooks_semantic", {
              p_query_embedding: vecLiteral(queryEmbedding!) as unknown as number[],
              p_audience: audience,
              p_limit: 3,
            });
            pbRows = ((data ?? []) as PbRow[]).filter((r) => (r.similarity ?? 0) >= 0.55);
          } catch (e) {
            log.warn(
              "playbooks",
              `semantic playbook failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
              { requestId }
            );
          }
        }

        // Tier 2: legacy trigram
        if (pbRows.length === 0) {
          try {
            const { data } = await supabase.rpc("fleety_match_playbooks", {
              p_query: lastUserMessage.slice(0, 500),
              p_audience: audience,
              p_limit: 2,
            });
            pbRows = ((data ?? []) as PbRow[]).filter((r) => (r.similarity ?? 0) >= 0.18);
          } catch (e) {
            log.warn(
              "playbooks",
              `trigram playbook failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
              { requestId }
            );
          }
        }

        // Tier 3: intent-based fallback so practical answers always have a spine
        if (pbRows.length === 0) {
          try {
            const { data } = await supabase.rpc("fleety_playbooks_by_intent", {
              p_intent: intent,
              p_audience: audience,
              p_limit: 2,
            });
            pbRows = (data ?? []) as PbRow[];
          } catch (e) {
            log.warn(
              "playbooks",
              `intent fallback failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
              { requestId }
            );
          }
        }

        playbookHits = pbRows.length;
        if (pbRows.length > 0) {
          topPlaybookSlug = pbRows[0].slug;
          playbookContext =
            "\n\nPLAYBOOKS (admin-authored — use as the spine of your practical answer):\n" +
            pbRows
              .map((p) => {
                const steps = Array.isArray(p.steps)
                  ? (p.steps as Array<{ title?: string; detail?: string; estimate?: string }>)
                  : [];
                const stepsText = steps.length
                  ? steps
                      .map(
                        (s, i) =>
                          `    ${i + 1}. ${s.title ?? ""}${s.estimate ? ` (${s.estimate})` : ""}${s.detail ? ` — ${s.detail}` : ""}`
                      )
                      .join("\n")
                  : "    (no steps provided)";
                return `\n▸ ${p.title} [${p.slug}]\n  direct_answer: ${p.direct_answer}\n  steps:\n${stepsText}\n  done_criteria: ${(p.done_criteria ?? []).join(" | ") || "(none)"}\n  pitfalls: ${(p.common_pitfalls ?? []).join(" | ") || "(none)"}\n  ask_for_help: ${p.ask_for_help ?? "(none)"}`;
              })
              .join("\n");

          const rawChips = Array.isArray(pbRows[0].action_chips)
            ? (pbRows[0].action_chips as Array<{
                label: string;
                action_type: string;
                target_url?: string | null;
              }>)
            : [];
          actionChips = rawChips.slice(0, 4).filter((c) => c && c.label && c.action_type);
          if (pbRows[0].example_artifact_url && actionChips.length < 4) {
            actionChips.push({
              label: "Open example artifact",
              action_type: "link_open",
              target_url: pbRows[0].example_artifact_url,
            });
          }
        }

        // Examples — semantic preferred, trigram fallback
        type ExRow = {
          slug: string;
          title: string;
          deliverable_type: string;
          summary: string;
          excerpt: string;
          source_url: string | null;
          similarity: number;
        };
        let exRows: ExRow[] = [];
        if (haveEmbeddings) {
          try {
            const { data } = await supabase.rpc("fleety_match_examples_semantic", {
              p_query_embedding: vecLiteral(queryEmbedding!) as unknown as number[],
              p_limit: 2,
            });
            exRows = ((data ?? []) as ExRow[]).filter((r) => (r.similarity ?? 0) >= 0.5);
          } catch (e) {
            log.warn(
              "examples",
              `semantic examples failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
              { requestId }
            );
          }
        }
        if (exRows.length === 0) {
          try {
            const { data } = await supabase.rpc("fleety_match_examples", {
              p_query: lastUserMessage.slice(0, 500),
              p_playbook_slug: topPlaybookSlug,
              p_limit: 2,
            });
            exRows = ((data ?? []) as ExRow[]).filter((r) => (r.similarity ?? 0) >= 0.15);
          } catch (e) {
            log.warn(
              "examples",
              `trigram examples failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
              { requestId }
            );
          }
        }
        exampleHits = exRows.length;
        if (exRows.length > 0) {
          exampleContext =
            "\n\nWORKED EXAMPLES (anonymized excerpts from real Tech Fleet deliverables — quote one briefly so the user sees what 'good' looks like):\n" +
            exRows
              .map(
                (e) =>
                  `\n• ${e.title} (${e.deliverable_type}) — ${e.summary}\n  excerpt: ${e.excerpt.slice(0, 800)}`
              )
              .join("\n");
        }
      }

      // ── USER CONTEXT block (active project, current quest, profile) ──
      let userContext = "";
      try {
        const [profileRes, rosterRes, questRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("first_name, role, time_zone")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("project_roster")
            .select("project_name, client_name, member_role, phase, status, end_date")
            .eq("member_email", user.email ?? "__none__")
            .in("status", ["Active", "Active Participant", "In Progress"])
            .order("synced_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("user_quest_selections")
            .select("path_id, started_at, completed_at, quest_paths(title)")
            .eq("user_id", user.id)
            .is("completed_at", null)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const lines: string[] = [];
        const p = profileRes.data as {
          first_name?: string;
          role?: string;
          time_zone?: string;
        } | null;
        if (p?.first_name) lines.push(`First name: ${p.first_name}`);
        if (p?.role) lines.push(`Self-described role: ${p.role}`);
        const r = rosterRes.data as {
          project_name?: string;
          client_name?: string;
          member_role?: string;
          phase?: string;
          end_date?: string;
        } | null;
        if (r?.project_name) {
          lines.push(
            `Active project: ${r.project_name}${r.client_name ? ` (client: ${r.client_name})` : ""}`
          );
          if (r.member_role) lines.push(`Their role on the project: ${r.member_role}`);
          if (r.phase) lines.push(`Current phase: ${r.phase}`);
          if (r.end_date) lines.push(`Project end date: ${r.end_date}`);
        }
        const q = questRes.data as {
          quest_paths?: { title?: string } | null;
          started_at?: string;
        } | null;
        if (q?.quest_paths?.title) lines.push(`Active quest: ${q.quest_paths.title}`);
        if (safeClientPath) {
          const pageLabelMap: Array<[RegExp, string]> = [
            [/^\/journey\/quests/, "Quests overview"],
            [/^\/journey\/active/, "Active project"],
            [/^\/journey/, "My Journey"],
            [/^\/projects\/openings/, "Project openings"],
            [/^\/projects\/[^/]+/, "Project detail"],
            [/^\/learning\/lesson/, "Lesson player"],
            [/^\/learning/, "Learning paths"],
            [/^\/resources/, "Resources"],
            [/^\/network/, "Network activity"],
            [/^\/profile/, "Profile"],
            [/^\/dashboard/, "Dashboard"],
            [/^\/admin/, "Admin area"],
          ];
          const friendly = pageLabelMap.find(([re]) => re.test(safeClientPath))?.[1];
          lines.push(`Currently viewing: ${friendly ?? safeClientPath} (${safeClientPath})`);
        }
        if (lines.length > 0) {
          userContext =
            "\n\nUSER CONTEXT (tailor your steps to this person's actual situation when relevant — do not echo this block back):\n" +
            lines.map((l) => `  - ${l}`).join("\n") +
            "\n";
        }
      } catch (e) {
        log.warn(
          "user-ctx",
          `user-context lookup failed [${requestId}]: ${e instanceof Error ? e.message : "unknown"}`,
          { requestId }
        );
      }

      // LLM07: Inject canary phrase into system prompt to detect leakage.
      // Order matters for "lost in the middle": put high-signal action context
      // (canned, user, playbooks, contract) at the TOP and bottom; bury the
      // big reference KB in the middle where models attend less.
      // D-17: the prompt is assembled by the pure builder in prompt.ts (single
      // source of truth, CI token-budget gated). This reproduces the exact
      // concatenation the handler used inline before — a no-behaviour-change
      // extraction.
      // UC-04 honesty hard-gate: if NOTHING grounded this turn (no KB, framework,
      // canned, playbook, example or few-shot context), swap the empty KB slot for
      // an explicit do-not-fabricate directive so the model answers honestly
      // instead of inventing playbooks/processes.
      const hasGrounding = !!(
        knowledgeContext ||
        frameworkContext ||
        cannedContext ||
        playbookContext ||
        exampleContext ||
        fewShotContext
      );
      const groundedKnowledge = hasGrounding ? knowledgeContext : NO_KNOWLEDGE_DIRECTIVE;

      const fullSystemPrompt = buildSystemPrompt({
        audience,
        canaryPhrase: CANARY_PHRASE,
        practical,
        cannedContext,
        userContext,
        playbookContext,
        exampleContext,
        knowledgeContext: groundedKnowledge,
        frameworkContext,
        fewShotContext,
        webContext: webResult.context,
      });
      log.info("ai", `Sending request to Groq [${requestId}]`, {
        requestId,
        model: GROQ_MODEL,
        systemPromptLength: fullSystemPrompt.length,
        webSourceCount: webResult.sources.length,
        frameworkContextLength: frameworkContext.length,
        audience,
        cannedHit: !!cannedAnswerId,
        fewShotChars: fewShotContext.length,
        intent,
        practical,
        playbookHits,
        exampleHits,
      });

      // D-17a / D-15: prompt version is the CI-injected git SHA (PROMPT_VERSION),
      // recorded per turn for observability. No DB-backed version weighting / A/B
      // layer (the fleety_prompt_versions table and Prompt Versions tab are gone).
      const promptVersion = Deno.env.get("PROMPT_VERSION") || "dev";

      // Capture per-turn signals (best-effort, non-blocking)
      const turnStart = Date.now();
      let signalTurnId: string | null = null;
      try {
        const { data: sig } = await supabase
          .from("fleety_turn_signals")
          .insert({
            conversation_id: conversation_id ?? null,
            user_id: user.id,
            user_query: lastUserMessage.slice(0, 2000),
            audience,
            kb_hit_count: kbHits.length,
            framework_hit_count: frameworkContext ? 1 : 0,
            web_hit_count: webResult.sources.length,
            canned_answer_id: cannedAnswerId,
            intent,
            playbook_hits: playbookHits,
            example_hits: exampleHits,
            prompt_version: promptVersion,
          })
          .select("id")
          .single();
        signalTurnId = sig?.id ?? null;
      } catch (_) {
        /* don't block chat on signal write */
      }

      // ── Cost counter (Cost Plan v2 §7) ────────────────────────────────
      // Estimate tokens using a 4-chars/token heuristic; record input now so
      // we still capture cost even if the streaming response is aborted.
      // Output tokens are accounted as max_tokens budget — refined in Phase 3.
      const estTokensIn =
        Math.ceil(fullSystemPrompt.length / 4) +
        Math.ceil(
          sanitizedMessages.reduce(
            (n: number, m: { content: string }) => n + (m.content?.length || 0),
            0
          ) / 4
        );
      const estUsd = estTokensIn * PRICE_IN_PER_TOKEN + 4096 * PRICE_OUT_PER_TOKEN * 0.4; // assume 40% of cap
      supabase
        .rpc("fleety_record_cost", {
          _model: GROQ_MODEL,
          _tier: "B",
          _tokens_in: estTokensIn,
          _tokens_out: Math.round(4096 * 0.4),
          _est_usd: estUsd,
          _cache_hit: false,
          _canned_hit: !!cannedAnswerId,
        })
        .then(
          () => {},
          (e: unknown) =>
            log.warn("cost", `record_cost failed [${requestId}]`, {
              requestId,
              err: e instanceof Error ? e.message : String(e),
            })
        );

      // ── Cost guard HARD step: pause non-admin uncached turns ──────────
      if (costGuardStep === "hard" && audience !== "admin") {
        log.warn("cost-guard", `HARD step blocking non-admin uncached turn [${requestId}]`, {
          requestId,
        });
        return new Response(
          JSON.stringify({
            error:
              "Fleety is catching her breath. Try the search bar, the knowledge base, or office hours — she'll be back shortly.",
            guard: "hard",
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Retry-After": "1800",
              "X-Fleety-Guard": "hard",
            },
          }
        );
      }

      // Cost guard caps output: medium 4096→2048, hard (admin only here) 4096→3072
      const maxTokensCap =
        costGuardStep === "medium" ? 2048 : costGuardStep === "hard" ? 3072 : 4096;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          reasoning_effort: GROQ_REASONING_EFFORT, // reasoning stays on delta.reasoning, not delta.content
          messages: [{ role: "system", content: fullSystemPrompt }, ...sanitizedMessages],
          stream: true,
          max_tokens: maxTokensCap, // LLM10 + Cost Plan v2 §7
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          log.warn("ai", `AI gateway rate limit exceeded [${requestId}]`, {
            requestId,
            httpStatus: 429,
          });
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        if (response.status === 402) {
          log.warn("ai", `AI usage limit reached [${requestId}]`, { requestId, httpStatus: 402 });
          return new Response(
            JSON.stringify({ error: "AI usage limit reached. Please try again later." }),
            {
              status: 402,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        const t = await response.text();
        log.error("ai", `AI gateway error [${requestId}]: HTTP ${response.status}`, {
          requestId,
          httpStatus: response.status,
        });
        // OWASP A09: Don't leak error details to client
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      log.info("ai", `AI gateway streaming response started [${requestId}]`, { requestId });

      // OWASP AI: Create a transform stream to sanitize AI output content
      // Only sanitize the actual text content inside delta.content, not the raw SSE/JSON framing.
      // Also: capture the full assistant response so we can write it to L3 cache on completion.
      let assistantBuffer = "";
      // Only cache GROUNDED answers. The response cache is permanent (it grows
      // and never time-expires), so an ungrounded/fabricated reply would be
      // served for the life of the kb_version. `hasGrounding` is false when no
      // KB / framework / canned / playbook / example / few-shot context backed
      // the turn (e.g. while retrieval is degraded) — never persist those.
      const isCacheable =
        hasGrounding &&
        haveEmbeddings &&
        !cannedAnswerId &&
        webResult.sources.length === 0 &&
        lastUserMessage.length <= 800;
      const queryHash = isCacheable
        ? await sha256Hex(`${audience}|${lastUserMessage.trim().toLowerCase()}`)
        : "";

      // Follow-up sentinel detection. Once we see "<<FLEETY_FOLLOWUPS>>"
      // anywhere in streamed text, we stop forwarding content to the client
      // and capture everything after it for JSON parsing on flush.
      const FOLLOWUP_SENTINEL = "<<FLEETY_FOLLOWUPS>>";
      let visibleStream = "";
      let sentinelHit = false;
      let postSentinelBuf = "";
      let pendingTail = "";
      const SAFE_TAIL = FOLLOWUP_SENTINEL.length - 1;
      function splitSafe(s: string): [string, string] {
        if (s.length <= SAFE_TAIL) return ["", s];
        return [s.slice(0, s.length - SAFE_TAIL), s.slice(s.length - SAFE_TAIL)];
      }

      const sanitizeStream = new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk);
          const lines = text.split("\n");
          const sanitizedLines: string[] = [];

          for (const line of lines) {
            if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") {
              sanitizedLines.push(line);
              continue;
            }
            try {
              const jsonStr = line.slice(6);
              const parsed = JSON.parse(jsonStr);
              const content = parsed?.choices?.[0]?.delta?.content;
              if (typeof content === "string") {
                const sanitized = sanitizeAIOutput(content);
                if (isCacheable) assistantBuffer += sanitized;

                if (sentinelHit) {
                  postSentinelBuf += sanitized;
                  parsed.choices[0].delta.content = "";
                } else {
                  const combined = pendingTail + sanitized;
                  const idx = combined.indexOf(FOLLOWUP_SENTINEL);
                  if (idx !== -1) {
                    sentinelHit = true;
                    const before = combined.slice(0, idx);
                    postSentinelBuf += combined.slice(idx + FOLLOWUP_SENTINEL.length);
                    pendingTail = "";
                    const cleaned = before.replace(/\s*\n?\s*$/, "");
                    parsed.choices[0].delta.content = cleaned;
                    visibleStream += cleaned;
                  } else {
                    const [emit, hold] = splitSafe(combined);
                    pendingTail = hold;
                    parsed.choices[0].delta.content = emit;
                    visibleStream += emit;
                  }
                }
              }
              sanitizedLines.push("data: " + JSON.stringify(parsed));
            } catch {
              sanitizedLines.push(line);
            }
          }

          controller.enqueue(new TextEncoder().encode(sanitizedLines.join("\n")));
        },
        flush(controller) {
          // Flush any held tail that never formed a sentinel.
          if (!sentinelHit && pendingTail.length > 0) {
            const frame = { choices: [{ delta: { content: pendingTail }, index: 0 }] };
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(frame) + "\n\n"));
            visibleStream += pendingTail;
            pendingTail = "";
          }

          // Parse follow-ups and emit a custom SSE frame for the client.
          if (sentinelHit) {
            let followups: string[] = [];
            try {
              const trimmed = postSentinelBuf.trim();
              const match = trimmed.match(/^\[[\s\S]*?\]/);
              const arr = JSON.parse(match ? match[0] : trimmed);
              if (Array.isArray(arr)) {
                followups = arr
                  .filter((x): x is string => typeof x === "string")
                  .map((s) => sanitizeAIOutput(s).trim())
                  .filter(
                    (s) =>
                      s.length > 0 && s.length <= 120 && !/https?:\/\//i.test(s) && !/[<>]/.test(s)
                  )
                  .slice(0, 3);
              }
            } catch {
              /* malformed — drop silently */
            }

            if (followups.length > 0) {
              const frame = { fleety: { followups } };
              controller.enqueue(
                new TextEncoder().encode("data: " + JSON.stringify(frame) + "\n\n")
              );
            }
          }

          // Cache the visible (sentinel-stripped) text so replays match the UI.
          const cacheText = visibleStream || assistantBuffer;
          if (isCacheable && cacheText.length >= 80 && cacheText.length <= 16_000) {
            supabase
              .rpc("fleety_cache_store", {
                _query_hash: queryHash,
                _query_text: lastUserMessage.slice(0, 1000),
                _audience: audience,
                _response_md: cacheText,
                _sources: [],
                _tier: "B",
                _query_embedding: queryEmbedding
                  ? (vecLiteral(queryEmbedding) as unknown as number[])
                  : null,
                _turn_id: signalTurnId,
              })
              .then(
                () => {},
                (e: unknown) =>
                  log.warn(
                    "cache",
                    `cache_store failed [${requestId}]: ${e instanceof Error ? e.message : String(e)}`,
                    { requestId }
                  )
              );
          }
        },
      });

      const sanitizedBody = response.body!.pipeThrough(sanitizeStream);

      // Encode chips as base64 to keep header safe across HTTP intermediaries
      const chipsB64 =
        actionChips.length > 0
          ? btoa(unescape(encodeURIComponent(JSON.stringify(actionChips))))
          : "";

      // D-08: structural citations — navigable source URLs from the KB hits,
      // guaranteed by code (not the LLM). http(s) only, deduped, capped.
      const sourceUrls = extractSourceUrls(kbHits);

      const exposeHeaders: Record<string, string> = {
        ...corsHeaders,
        "Access-Control-Expose-Headers":
          "X-Fleety-Turn-Id, X-Fleety-Intent, X-Fleety-Chips, X-Fleety-Practical, X-Fleety-Cache, X-Fleety-Guard, X-Fleety-Sources",
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Fleety-Intent": intent,
        "X-Fleety-Practical": practical ? "1" : "0",
        "X-Fleety-Cache": "miss",
        "X-Fleety-Guard": costGuardStep,
      };
      if (signalTurnId) exposeHeaders["X-Fleety-Turn-Id"] = signalTurnId;
      if (chipsB64) exposeHeaders["X-Fleety-Chips"] = chipsB64;
      if (sourceUrls.length) exposeHeaders["X-Fleety-Sources"] = JSON.stringify(sourceUrls);

      return new Response(sanitizedBody, { headers: exposeHeaders });
    } catch (err) {
      log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
      // OWASP A09: Generic error message, no internal details
      return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
