import { CharCountTextarea } from "@/design-system";

export default function CharCountTextareaDemo() {
  return (
    <div style={{ width: "100%", maxWidth: 360 }}>
      <CharCountTextarea maxLength={140} minRows={3} defaultValue="A short bio…" aria-label="Bio" />
    </div>
  );
}
