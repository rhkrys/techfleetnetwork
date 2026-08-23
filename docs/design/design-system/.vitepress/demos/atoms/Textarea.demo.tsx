import { Textarea } from "@/design-system";

export default function TextareaDemo() {
  return (
    <div style={{ width: "100%", maxWidth: 340 }}>
      <Textarea placeholder="Write a few lines…" minRows={3} />
    </div>
  );
}
