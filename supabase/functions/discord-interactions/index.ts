// @edge-public
import nacl from "npm:tweetnacl@1.0.3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
import { isFreshTimestamp } from "./freshness.ts";
import { stripInternalLinks } from "./spf-links.ts";
import { withQuestionEcho } from "./echo.ts";
const log = createEdgeLogger("discord-interactions");

/* ── Discord constants ─────────────────────────────────────────────── */
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;

const MAX_DISCORD_LENGTH = 1950;
/** LLM10: Max input question length to prevent unbounded consumption */
const MAX_QUESTION_LENGTH = 2000;

/* ── Helpers ─────────────────────────────────────────────────────── */

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function verifySignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string | null
): boolean {
  if (!signature || !timestamp || !publicKey) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + body),
      hexToUint8Array(signature),
      hexToUint8Array(publicKey)
    );
  } catch {
    return false;
  }
}

// ── Fleety 2.1: one brain. Discord delegates the answer to the unified 2.0 handler ──
// (techfleet-chat) over a trusted internal call. ALL retrieval, grounding, prompt-injection +
// strict-scope gates, PII redaction, determinism, and real public source links come from 2.0 —
// the Discord bot no longer runs its own weaker Gemini/Lovable brain.
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

/**
 * Per-Discord-user rate limit — bounds abuse at the source BEFORE any 2.0 call, so a single
 * member can't spam /fleety and drain the shared budget. Fails OPEN (limiter errors never block a
 * legitimate question); the 2.0 handler's global system rate-limit + cost-guard are the backstop.
 */
async function underRateLimit(discordUserId: string): Promise<boolean> {
  try {
    const sb = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
    const { data, error } = await sb.rpc("check_rate_limit", {
      p_identifier: `discord:${discordUserId}`,
      p_action: "fleety",
      p_max_attempts: 10,
      p_window_minutes: 60,
      p_block_minutes: 15,
    });
    if (error) return true; // fail open
    return typeof data === "object" && data !== null
      ? (data as { allowed?: boolean }).allowed !== false
      : data !== false;
  } catch {
    return true;
  }
}

/**
 * Ask the unified 2.0 brain and return { answer, sources }. Posts the question as a normal user
 * turn; techfleet-chat handles retrieval/grounding/safety. Egress target is fixed (env-derived,
 * never from Discord input) → no SSRF. Consumes the SSE stream (uniform
 * `data: {choices:[{delta:{content}}]}` frames + `data: [DONE]`).
 */
async function askFleety2(question: string): Promise<{ answer: string; sources: string[] }> {
  const internalSecret = Deno.env.get("FLEETY_INTERNAL_SECRET");
  if (!internalSecret) throw new Error("FLEETY_INTERNAL_SECRET not configured");
  const q = question.slice(0, MAX_QUESTION_LENGTH); // bound input (LLM10)

  const res = await fetch(`${SB_URL}/functions/v1/techfleet-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_ANON_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, // pass the edge gateway (defense in depth)
      "x-fleety-internal": internalSecret, // trusted-caller seam
    },
    body: JSON.stringify({ messages: [{ role: "user", content: q }], client_path: "discord" }),
  });
  if (!res.ok || !res.body) throw new Error(`techfleet-chat [${res.status}]`);

  let sources: string[] = [];
  const sh = res.headers.get("X-Fleety-Sources");
  if (sh) {
    try {
      const arr = JSON.parse(sh);
      if (Array.isArray(arr))
        sources = arr.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
    } catch {
      /* ignore malformed header */
    }
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let answer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") answer += delta;
      } catch {
        /* skip non-JSON keepalive/frame */
      }
    }
  }
  return { answer: answer.trim() || "I couldn't generate a response. Please try again.", sources };
}

/** LLM02: PII patterns to redact from output */
const PII_OUTPUT_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

function sanitizeDiscordOutput(text: string): string {
  let sanitized = text;
  for (const pattern of PII_OUTPUT_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  // Belt-and-suspenders: strip any internal-scheme link (framework://, csv://) that slipped through.
  sanitized = stripInternalLinks(sanitized);
  return sanitized;
}

/** Split content into chunks that fit Discord's message limit, breaking at newlines when possible */
function splitMessage(content: string): string[] {
  if (content.length <= MAX_DISCORD_LENGTH) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_DISCORD_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to break at a newline within the limit
    let breakIdx = remaining.lastIndexOf("\n", MAX_DISCORD_LENGTH);
    if (breakIdx < MAX_DISCORD_LENGTH * 0.3) {
      // If newline break is too early, try a space
      breakIdx = remaining.lastIndexOf(" ", MAX_DISCORD_LENGTH);
    }
    if (breakIdx < MAX_DISCORD_LENGTH * 0.3) {
      // Hard break as last resort
      breakIdx = MAX_DISCORD_LENGTH;
    }

    chunks.push(remaining.substring(0, breakIdx));
    remaining = remaining.substring(breakIdx).trimStart();
  }

  return chunks;
}

async function postFollowup(
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<void> {
  const chunks = splitMessage(content);
  const baseUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`;

  for (let i = 0; i < chunks.length; i++) {
    const { response: res, retries } = await discordFetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunks[i] }),
    });

    if (retries > 0) {
      log.info(
        "followup",
        `Followup part ${i + 1}/${chunks.length} succeeded after ${retries} retries`
      );
    }

    if (!res.ok) {
      const text = await res.text();
      log.error(
        "followup",
        `Failed to post followup part ${i + 1}/${chunks.length} [${res.status}]: ${text.substring(0, 300)}`
      );
      break;
    } else {
      await res.text(); // consume body
    }

    // Small delay between chunks to respect rate limits
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/* ── Main handler ─────────────────────────────────────────────────── */

Deno.serve(
  withAuditWrapper("discord-interactions", async (req) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await req.text();

    // ── Verify Discord signature ──
    const publicKey = Deno.env.get("DISCORD_APPLICATION_PUBLIC_KEY");
    const isValid = verifySignature(
      body,
      req.headers.get("x-signature-ed25519"),
      req.headers.get("x-signature-timestamp"),
      publicKey ?? null
    );

    if (!isValid) {
      log.warn("auth", "Invalid Discord signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // Bound replay: the signature covers the timestamp, so reject a validly-signed
    // request that is older/newer than the ±5min window (audit T-F).
    if (!isFreshTimestamp(req.headers.get("x-signature-timestamp"), Date.now())) {
      log.warn("auth", "Stale Discord signature timestamp (replay window)");
      return new Response("Invalid signature", { status: 401 });
    }

    let interaction: Record<string, unknown>;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // ── PING → PONG (required for endpoint verification) ──
    if (interaction.type === INTERACTION_PING) {
      log.info("ping", "Received Discord PING verification");
      return new Response(JSON.stringify({ type: RESPONSE_PONG }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Slash command ──
    if (interaction.type === INTERACTION_APPLICATION_COMMAND) {
      const data = interaction.data as Record<string, unknown> | undefined;
      const commandName = data?.name as string | undefined;

      const options = data?.options as Array<{ name: string; value: string }> | undefined;
      const applicationId = Deno.env.get("DISCORD_APPLICATION_ID") ?? "";
      const interactionToken = interaction.token as string;
      const discordUser = (interaction.member as Record<string, unknown> | undefined)?.user as
        Record<string, unknown> | undefined;
      const discordUserId = discordUser?.id as string | undefined;
      const userName = discordUser?.username as string | undefined;

      // Keep the edge function alive after returning the deferred response.
      const keepAlive = (work: Promise<void>) => {
        try {
          const edgeRuntime = (globalThis as Record<string, unknown>).EdgeRuntime as
            { waitUntil?: (p: Promise<void>) => void } | undefined;
          edgeRuntime?.waitUntil?.(work);
        } catch {
          // fallback: the promise still runs
        }
      };

      // ── /support → open a Freescout ticket for the linked member ──
      if (commandName === "support") {
        // Input validation parity with the web create's zod: drop control chars
        // from the subject (single-line) and null bytes from the body. Codepoint
        // filter (not a regex literal) keeps this source ASCII-clean.
        const dropControls = (s: string) =>
          Array.from(s)
            .filter((ch) => {
              const c = ch.charCodeAt(0);
              return c >= 0x20 && c !== 0x7f;
            })
            .join("");
        const dropNulls = (s: string) =>
          Array.from(s)
            .filter((ch) => ch.charCodeAt(0) !== 0)
            .join("");
        const subject = dropControls(options?.find((o) => o.name === "subject")?.value ?? "")
          .trim()
          .slice(0, 200);
        const details = dropNulls(options?.find((o) => o.name === "details")?.value ?? "")
          .trim()
          .slice(0, 10000);

        const work = (async () => {
          try {
            if (!discordUserId) {
              await postFollowup(
                applicationId,
                interactionToken,
                "⚠️ Could not read your Discord identity — please try again."
              );
              return;
            }
            if (subject.length < 3 || details.length < 1) {
              await postFollowup(
                applicationId,
                interactionToken,
                "⚠️ Please include a subject (at least 3 characters) and a short message."
              );
              return;
            }
            // Lazy import: keeps the FREESCOUT_API_KEY boot tripwire on the /support
            // path only, so it can never break /fleety or the PING handshake.
            const { createSupportTicketFromDiscord } = await import("../_shared/support-ticket.ts");
            const result = await createSupportTicketFromDiscord(discordUserId, subject, details);
            if (result.status === "unlinked") {
              await postFollowup(
                applicationId,
                interactionToken,
                "🔗 Your Discord isn't linked to a Tech Fleet account yet. Link it at <https://techfleet.network/community/connect-discord>, then run `/support` again."
              );
            } else if (result.status === "no_email") {
              await postFollowup(
                applicationId,
                interactionToken,
                "⚠️ Your Tech Fleet account has no email on file. Add one in your profile, then try again."
              );
            } else if (result.status === "rate_limited") {
              await postFollowup(
                applicationId,
                interactionToken,
                "🚦 You've opened several tickets recently. Please wait a bit before creating another, or reply to an existing ticket."
              );
            } else if (result.status === "ok") {
              await postFollowup(
                applicationId,
                interactionToken,
                "✅ Support ticket created! A Support Agent will reply by email, and you can track it at <https://techfleet.network/community/get-help>."
              );
              log.info("support", `Ticket created from Discord for ${userName ?? "unknown"}`);
            } else {
              await postFollowup(
                applicationId,
                interactionToken,
                "⚠️ Sorry, we couldn't create your ticket right now. Please try again shortly."
              );
              log.error("support", `Ticket creation failed: ${result.message}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("support", `Error: ${msg}`);
            await postFollowup(
              applicationId,
              interactionToken,
              "⚠️ Sorry, we couldn't create your ticket right now. Please try again shortly."
            );
          }
        })();
        keepAlive(work);
        // Ephemeral defer (flags 64) — a member's support request + confirmation
        // stay private to them, not posted in the channel.
        return new Response(
          JSON.stringify({ type: RESPONSE_DEFERRED_CHANNEL_MESSAGE, data: { flags: 64 } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // ── /fleety → AI answer ──
      if (commandName === "fleety") {
        const question = options?.find((o) => o.name === "question")?.value ?? "";
        log.info(
          "command",
          `Fleety command from ${userName ?? "unknown"}: ${question.substring(0, 100)}`
        );

        const work = (async () => {
          try {
            // Bound abuse at the source before spending any 2.0 budget.
            if (discordUserId && !(await underRateLimit(discordUserId))) {
              await postFollowup(
                applicationId,
                interactionToken,
                "🚦 You've asked Fleety a lot in the last hour — give it a few minutes and try again."
              );
              return;
            }
            // One brain: delegate to the unified 2.0 handler.
            const { answer, sources } = await askFleety2(question);
            let body = answer;
            if (sources.length) {
              // Angle-bracket the URLs so Discord doesn't spam link embeds.
              const top = sources
                .slice(0, 5)
                .map((u) => `- <${u}>`)
                .join("\n");
              body += `\n\n📚 **Sources**\n${top}`;
            }
            // Echo the question (sanitized: no mention/markdown injection), then redact output PII.
            const final = sanitizeDiscordOutput(withQuestionEcho(question, body));
            await postFollowup(applicationId, interactionToken, final);
            log.info("done", `Answered question from ${userName ?? "unknown"} via 2.0`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("process", `Error: ${msg}`);
            await postFollowup(
              applicationId,
              interactionToken,
              "⚠️ Sorry, I encountered an error processing your question. Please try again later."
            );
          }
        })();
        keepAlive(work);
        return new Response(JSON.stringify({ type: RESPONSE_DEFERRED_CHANNEL_MESSAGE }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Unknown command → no-op PONG
      return new Response(JSON.stringify({ type: RESPONSE_PONG }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Unknown interaction type
    return new Response(JSON.stringify({ type: RESPONSE_PONG }), {
      headers: { "Content-Type": "application/json" },
    });
  })
);
