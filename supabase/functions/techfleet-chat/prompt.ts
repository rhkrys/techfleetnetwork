// supabase/functions/techfleet-chat/prompt.ts
//
// Single source of truth for Fleety's behavior instructions (PRD D-17 / UC-24).
// PURE module: no I/O, no side effects, no DB, no env reads. Loaded at cold
// start and called once per turn by index.ts via buildSystemPrompt(ctx).
//
// The BASE prompt (with empty dynamic slots) must stay within the configured
// token ceiling — enforced by prompt.test.ts (D-17b CI token-budget gate) so a
// prompt change can never silently squeeze KB context at runtime.
//
// No prompt is stored in the database. No admin UI edits the prompt. Changing
// Fleety's behavior is a PR to this file, reviewed and CI-gated. Rollback is
// `git revert` + deploy (< 5 min), traceable via PROMPT_VERSION on each turn.

export interface PromptContext {
  audience: "member" | "teacher" | "admin";
  /** Audience-specific tone instruction (see TONE_PRESETS). */
  tonePreset: string;
  /** Formatted member memory (from fleety_user_memory via formatUserContext). */
  userContext: string;
  /** Retrieved KB entries with their source URLs, formatted for the model. */
  kbContext: string;
}

export const TONE_PRESETS: Record<PromptContext["audience"], string> = {
  member:
    "Use friendly, jargon-free language. Explain framework terms the first time you use them.",
  teacher:
    "Slightly more technical phrasing is OK. Reference how to coach trainees through the concept.",
  admin:
    "Be precise and operational. Include relevant configuration or data details when helpful.",
};

/**
 * Build the full system prompt. Pure and deterministic: identical input always
 * yields identical output. Three named injection slots — tone, user context,
 * knowledge — are the ONLY dynamic content.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  return `You are Fleety, the Tech Fleet guidance assistant.
You answer questions exclusively from the knowledge provided below.
Never invent facts. If the knowledge does not cover a question, say so honestly
and suggest guide.techfleet.org or the Tech Fleet Discord as alternatives.

[AUDIENCE TONE]
${ctx.tonePreset}

[USER CONTEXT]
${ctx.userContext || "No prior context for this member."}

[KNOWLEDGE]
${ctx.kbContext}
`.trim();
}

/**
 * Format member memory rows (from fleety_load_user_memories) into the natural
 * language block injected into the USER CONTEXT slot. Returns "" when there is
 * no memory, so buildSystemPrompt falls back to its default line.
 */
export function formatUserContext(
  memories: Array<{ memory_key: string; memory_value: string; category: string }>,
): string {
  if (!memories.length) return "";
  const lines = memories.map(
    (m) => `- ${m.category}: ${m.memory_key} = ${m.memory_value}`,
  );
  return ["What I know about this member:", ...lines].join("\n");
}
