import { TextareaAutosize } from "@/design-system";

export default function TextareaAutosizeDemo() {
  return (
    <TextareaAutosize
      minRows={2}
      maxRows={6}
      placeholder="Type multiple lines — I grow to fit the content…"
      style={{
        width: "100%",
        maxWidth: 360,
        padding: 10,
        borderRadius: 6,
        border: "1px solid var(--vp-c-divider)",
        background: "transparent",
        color: "inherit",
        fontFamily: "inherit",
        fontSize: 14,
        resize: "none",
      }}
    />
  );
}
