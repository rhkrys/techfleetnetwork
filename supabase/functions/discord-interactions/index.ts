// @edge-public
import nacl from "npm:tweetnacl@1.0.3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
import { isFreshTimestamp } from "./freshness.ts";
const log = createEdgeLogger("discord-interactions");

/* ── Discord constants ─────────────────────────────────────────────── */
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;

const MAX_DISCORD_LENGTH = 1950;
/** LLM10: Max input question length to prevent unbounded consumption */
const MAX_QUESTION_LENGTH = 2000;

/* ── Fleety system prompt (Discord‑adapted) ─────────────────────── */
const SYSTEM_PROMPT = `You are Fleety, the official Tech Fleet Assistant — a helpful AI that answers questions exclusively about Tech Fleet, its community, processes, team practices, workshops, handbooks, and onboarding.

IMPORTANT RULES:
1. ONLY answer questions using the Tech Fleet knowledge base provided below. Do NOT use any external knowledge or information from the internet.
2. If a question is not related to Tech Fleet, politely redirect the user to ask about Tech Fleet topics.
3. If you don't have enough information in the knowledge base to answer a question, say so honestly rather than making up an answer.
4. Do not discuss topics outside of Tech Fleet, even if the user insists.

FORMATTING RULES — follow these strictly (you are responding in Discord):
1. Use Discord-compatible markdown: **bold**, *italic*, \`code\`, \`\`\`code blocks\`\`\`, > blockquotes, bullet points, numbered lists.
2. Do NOT use HTML or headings larger than bold text.
3. Keep paragraphs short (2-3 sentences max) for easy scanning.
4. Use line breaks between sections for readability.
5. When listing items, always use bullet points or numbered lists.
6. Keep your total response under 1800 characters so it fits in a single Discord message.

SOURCE CITATION RULES — follow these strictly:
1. ALWAYS cite your sources at the end of your answer in a "📚 **Sources**" section.
2. For each source, include the title and a clickable link using the URL from the knowledge base.
3. Only cite sources you actually used to form your answer.
4. Format sources as a bulleted list like:
   - [Source Title](url)
5. If a source URL starts with "csv://", do NOT include it as a link — instead just mention it as internal reference data.
6. For Notion URLs, use the full URL as the link.
7. For guide.techfleet.org URLs, use the full URL as the link.

KNOWLEDGE BASE:
`;

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

async function loadKnowledgeBase(): Promise<string> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: knowledge, error } = await supabase
    .from("knowledge_base")
    .select("title, content, url")
    .order("title");

  if (error) {
    log.error("kb", `Failed to load knowledge base: ${error.message}`);
  }

  if (!knowledge?.length) {
    return "\nNo knowledge base content available yet.\n";
  }

  let ctx = "";
  for (const entry of knowledge) {
    const truncated =
      entry.content.length > 3000
        ? entry.content.substring(0, 3000) + "...[truncated]"
        : entry.content;
    ctx += `\n---\nSOURCE: ${entry.title} (${entry.url})\n${truncated}\n`;
  }
  return ctx;
}

/** LLM01: Prompt injection detection for Discord */
const DISCORD_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the|DAN|jailbroken)/i,
  /system\s*prompt/i,
  /\[SYSTEM\]/i,
  /reveal\s+(your|the)\s+(system|initial)\s+(prompt|instructions?)/i,
  /bypass\s+(the\s+)?(restrictions?|filters?|safety)/i,
  /jailbreak/i,
];

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
  return sanitized;
}

async function getAIResponse(question: string, knowledgeCtx: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  // LLM10: Truncate question to prevent unbounded input
  const truncatedQuestion = question.slice(0, MAX_QUESTION_LENGTH);

  // LLM01: Log injection attempts
  if (DISCORD_INJECTION_PATTERNS.some((p) => p.test(truncatedQuestion))) {
    log.warn(
      "prompt-injection",
      `Potential injection in Discord command: ${truncatedQuestion.substring(0, 80)}`
    );
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + knowledgeCtx },
        { role: "user", content: truncatedQuestion },
      ],
      stream: false,
      max_tokens: 1800, // LLM10: Cap output to fit Discord message limits
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI gateway error [${response.status}]: ${text.substring(0, 300)}`);
  }

  const data = await response.json();
  const rawOutput =
    data.choices?.[0]?.message?.content ?? "I couldn't generate a response. Please try again.";
  // LLM02/LLM05: Sanitize output before returning
  return sanitizeDiscordOutput(rawOutput);
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
            const knowledgeCtx = await loadKnowledgeBase();
            const answer = await getAIResponse(question, knowledgeCtx);
            await postFollowup(applicationId, interactionToken, answer);
            log.info("done", `Answered question from ${userName ?? "unknown"}`);
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
