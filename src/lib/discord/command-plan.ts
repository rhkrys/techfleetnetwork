// Declarative Discord slash-command manifest + the deletion-safety planner.
//
// Single source of truth for which slash commands exist. Consumed by the
// deploy-time registrar (scripts/register-discord-commands.ts, run via tsx) and
// unit-tested here. Registration is a bulk overwrite that reconciles Discord to
// EXACTLY this list, so the list must be complete.

export interface DiscordCommandOption {
  name: string;
  description: string;
  type: number; // 3 = STRING
  required?: boolean;
}

export interface DiscordCommand {
  name: string;
  description: string;
  type: number; // 1 = CHAT_INPUT
  options?: DiscordCommandOption[];
}

/** The complete, intended set of global slash commands. */
export const COMMANDS: DiscordCommand[] = [
  {
    name: "fleety",
    description: "Ask Fleety about Tech Fleet — guidance, resources, workshops, and more",
    type: 1,
    options: [
      { name: "question", description: "Your question about Tech Fleet", type: 3, required: true },
    ],
  },
  {
    name: "support",
    description: "Open a Tech Fleet support ticket",
    type: 1,
    options: [
      { name: "subject", description: "A short summary of your issue", type: 3, required: true },
      { name: "details", description: "What do you need help with?", type: 3, required: true },
    ],
  },
];

export interface CommandPlan {
  deletions: string[];
  blocked: boolean;
}

/**
 * OWASP Step-0 accidental-deletion guard. Discord's bulk overwrite replaces the
 * ENTIRE command set, so any currently-registered command missing from the
 * manifest would be deleted. Returns which commands would be deleted and whether
 * the run must be blocked (deletions present without an explicit override).
 */
export function planCommandChanges(
  currentNames: string[],
  manifestNames: string[],
  allowDelete = false,
): CommandPlan {
  const manifest = new Set(manifestNames);
  const deletions = currentNames.filter((n) => !manifest.has(n));
  return { deletions, blocked: deletions.length > 0 && !allowDelete };
}
