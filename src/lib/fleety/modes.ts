// Single source of truth for Fleety's conversation modes — a UI switch, like Claude's
// chat / plan modes. Both chat surfaces (ChatPage and FleetyChatWidget) import from here so
// the mode ids, labels, and placeholders can never drift, and the id union stays in lockstep
// with the server's `mode` enum in supabase/functions/techfleet-chat (validated there with zod).

export type FleetyMode = "chat" | "review" | "plan";

export interface FleetyModeMeta {
  id: FleetyMode;
  /** Full name for tooltips / wide layouts. */
  label: string;
  /** Compact label for the pill control. */
  short: string;
  /** Mode-aware input placeholder. */
  placeholder: string;
}

export const FLEETY_MODES: readonly FleetyModeMeta[] = [
  {
    id: "chat",
    label: "Chat",
    short: "Chat",
    placeholder: "Ask about Tech Fleet...",
  },
  {
    id: "review",
    label: "Deliverables Review",
    short: "Review",
    placeholder: "Paste your work or a Figma / doc link to review against the SPF...",
  },
  {
    id: "plan",
    label: "Plan",
    short: "Plan",
    placeholder: "What do you want to plan? (e.g. my discovery research)",
  },
] as const;

/** The default mode (Chat), and the resolver both surfaces use to look up the active meta. */
export const DEFAULT_FLEETY_MODE: FleetyMode = "chat";

export function fleetyModeMeta(mode: FleetyMode): FleetyModeMeta {
  return FLEETY_MODES.find((m) => m.id === mode) ?? FLEETY_MODES[0];
}

/** Type guard: is an arbitrary string one of our known mode ids? */
export function isFleetyMode(v: unknown): v is FleetyMode {
  return typeof v === "string" && FLEETY_MODES.some((m) => m.id === v);
}

// Remember the member's last-selected mode across reloads (the pattern Claude/ChatGPT use for the
// model/style picker). localStorage is best-effort — SSR, privacy mode, or a disabled store all fall
// back to the default rather than throwing.
const MODE_STORAGE_KEY = "fleety.mode";

export function loadStoredMode(): FleetyMode {
  try {
    const v = globalThis.localStorage?.getItem(MODE_STORAGE_KEY);
    if (isFleetyMode(v)) return v;
  } catch {
    /* storage unavailable — use default */
  }
  return DEFAULT_FLEETY_MODE;
}

export function storeMode(mode: FleetyMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — non-fatal */
  }
}
