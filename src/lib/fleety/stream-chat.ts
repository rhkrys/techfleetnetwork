// Canonical client for streaming a Fleety turn from the `techfleet-chat` edge function.
//
// Extracted verbatim from FleetyChatWidget's local `streamChat` (the most complete of the
// three inline copies) so new surfaces — starting with the TAL 9000 terminal — reuse ONE
// implementation instead of adding a 4th copy. The existing three chat surfaces (ChatPage,
// FleetyChatWidget, GuidanceEmbed) still carry their inline copies; converging them onto this
// module is a deliberate follow-up (kept out of this PR to avoid destabilising live chat).
//
// Contract (server-guaranteed, independent of model output):
//   - answer streams token-by-token as OpenAI-style SSE `data: {choices:[{delta:{content}}]}`,
//     terminated by `data: [DONE]` (cache hits stream too, so the client path is identical).
//   - follow-ups arrive in-band as `data: {fleety:{followups:[...]}}`.
//   - sources  → `X-Fleety-Sources` header (JSON array of URL strings).
//   - chips    → `X-Fleety-Chips`  header (base64 JSON).
//   - turn id  → `X-Fleety-Turn-Id` header (ties 👍/👎 feedback to the answer).
// Auth uses the member session JWT (never the static publishable key). See OWASP LLM02/ASVS V13.2.
import { getSessionSafe } from "@/lib/auth/session-port";
import type { FleetyMode } from "@/lib/fleety/modes";

export type ActionChip = { label: string; action_type: string; target_url?: string | null };

/** Only role+content are sent to the server; callers may hold richer message objects. */
export type FleetyChatMsg = { role: "user" | "assistant"; content: string };

export const FLEETY_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/techfleet-chat`;

/** OWASP LLM10 unbounded-consumption guard: cap per-message input length. */
export const MAX_INPUT_LENGTH = 4000;

export type StreamChatArgs = {
  messages: FleetyChatMsg[];
  conversationId: string | null;
  clientPath: string | null;
  mode: FleetyMode;
  attachment?: { filename: string; text: string };
  onDelta: (deltaText: string) => void;
  onTurnId: (id: string | null) => void;
  onChips: (chips: ActionChip[]) => void;
  onFollowups: (followups: string[]) => void;
  onSources: (urls: string[]) => void;
  onDone: () => void;
};

export async function streamChat({
  messages,
  conversationId,
  clientPath,
  mode,
  attachment,
  onDelta,
  onTurnId,
  onChips,
  onFollowups,
  onSources,
  onDone,
}: StreamChatArgs): Promise<void> {
  const session = await getSessionSafe();
  const token = session?.access_token;
  if (!token) throw new Error("Authentication required. Please sign in again.");

  const sanitizedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_INPUT_LENGTH),
  }));

  const resp = await fetch(FLEETY_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: sanitizedMessages,
      conversation_id: conversationId,
      client_path: clientPath ? clientPath.slice(0, 200) : null,
      mode,
      attachment,
    }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}) as Record<string, unknown>);
    throw new Error((errData as { error?: string }).error || `Request failed (${resp.status})`);
  }

  onTurnId(resp.headers.get("X-Fleety-Turn-Id"));

  const chipsHeader = resp.headers.get("X-Fleety-Chips");
  if (chipsHeader) {
    try {
      const decoded = decodeURIComponent(escape(atob(chipsHeader)));
      const parsed = JSON.parse(decoded) as ActionChip[];
      if (Array.isArray(parsed)) onChips(parsed.slice(0, 4));
    } catch {
      /* ignore malformed header */
    }
  }

  // Structural citations guaranteed by the server (navigable guide/SPF links from the
  // retrieved KB entries), independent of what the model wrote.
  const srcHeader = resp.headers.get("X-Fleety-Sources");
  if (srcHeader) {
    try {
      const urls = JSON.parse(srcHeader);
      if (Array.isArray(urls) && urls.length) {
        onSources(urls.filter((u: unknown): u is string => typeof u === "string"));
      }
    } catch {
      /* header malformed — ignore, the answer still renders */
    }
  }

  if (!resp.body) throw new Error("No response stream");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;

  const handleLine = (rawLine: string): "done" | "continue" | "retry" => {
    let line = rawLine;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.startsWith(":") || line.trim() === "") return "continue";
    if (!line.startsWith("data: ")) return "continue";
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") return "done";
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed?.fleety?.followups && Array.isArray(parsed.fleety.followups)) {
        const cleaned = parsed.fleety.followups
          .filter((s: unknown) => typeof s === "string")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0 && s.length <= 120)
          .slice(0, 3);
        if (cleaned.length > 0) onFollowups(cleaned);
      } else {
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      }
      return "continue";
    } catch {
      return "retry";
    }
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      const line = textBuffer.slice(0, newlineIndex);
      const rest = textBuffer.slice(newlineIndex + 1);
      const result = handleLine(line);
      if (result === "retry") {
        // Incomplete JSON split across chunks — put it back and wait for more.
        textBuffer = line + "\n" + rest;
        break;
      }
      textBuffer = rest;
      if (result === "done") {
        streamDone = true;
        break;
      }
    }
  }

  // Flush any trailing buffered lines.
  if (textBuffer.trim()) {
    for (const raw of textBuffer.split("\n")) {
      if (!raw) continue;
      if (handleLine(raw) === "done") break;
    }
  }

  onDone();
}
