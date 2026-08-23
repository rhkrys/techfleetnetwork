import { SaveStatus } from "@/design-system";

// Fixed timestamp so the demo renders deterministically (no impure Date.now()).
const SAVED_AT = 1_700_000_000_000;

export default function SaveStatusDemo() {
  return (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
      <SaveStatus state="saving" />
      <SaveStatus state="saved" savedAt={SAVED_AT} />
      <SaveStatus state="error" onRetry={() => {}} />
    </div>
  );
}
