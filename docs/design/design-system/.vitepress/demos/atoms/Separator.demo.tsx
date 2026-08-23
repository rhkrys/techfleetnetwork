import { Separator } from "@/design-system";

export default function SeparatorDemo() {
  return (
    <div style={{ width: "100%", maxWidth: 320 }}>
      <div>Above</div>
      <Separator style={{ margin: "12px 0" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 24 }}>
        <span>Left</span>
        <Separator orientation="vertical" flexItem />
        <span>Right</span>
      </div>
    </div>
  );
}
