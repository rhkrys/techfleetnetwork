/**
 * SaveStatus (molecule) — consolidates the three legacy save-status components
 * (save-status.tsx, SaveStatus.tsx, AutosaveStatus.tsx) into one.
 * States: idle / dirty / saving / saved / error. Announces changes via a polite
 * live region (data-no-translate/translate="no" guard) and offers Retry on error.
 * See docs/design/design-system/components/molecules/SaveStatus.md
 */
import { Button } from "../atoms/Button";
import { Text } from "../atoms/Text";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps {
  state: SaveState;
  savedAt?: Date | string | null;
  onRetry?: () => void;
}

const LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

const COLOR: Record<SaveState, "default" | "muted" | "primary"> = {
  idle: "muted",
  dirty: "muted",
  saving: "muted",
  saved: "muted",
  error: "default",
};

export function SaveStatus({ state, savedAt, onRetry }: SaveStatusProps) {
  if (state === "idle") return null;
  const when =
    state === "saved" && savedAt
      ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-no-translate="true"
      translate="no"
      style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
    >
      <Text
        brand="caption"
        color={COLOR[state]}
        sx={{ color: state === "error" ? "error.main" : undefined }}
      >
        {LABEL[state]}
        {when ? ` at ${when}` : ""}
      </Text>
      {state === "error" && onRetry && (
        <Button variant="link" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
