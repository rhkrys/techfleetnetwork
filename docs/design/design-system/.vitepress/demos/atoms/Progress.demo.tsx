import { Progress } from "@/design-system";

export default function ProgressDemo() {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 360 }}
    >
      <div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Determinate (65%)</div>
        <Progress value={65} />
      </div>
      <div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Indeterminate</div>
        <Progress />
      </div>
    </div>
  );
}
