import { ScrollArea } from "@/design-system";

export default function ScrollAreaDemo() {
  return (
    <ScrollArea
      style={{
        height: 140,
        width: 280,
        border: "1px solid var(--vp-c-divider)",
        borderRadius: 8,
        padding: 12,
      }}
    >
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i} style={{ padding: "6px 0" }}>
          Scrollable row {i + 1}
        </div>
      ))}
    </ScrollArea>
  );
}
