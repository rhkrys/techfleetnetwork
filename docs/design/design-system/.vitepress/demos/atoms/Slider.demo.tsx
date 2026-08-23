import { Slider } from "@/design-system";

export default function SliderDemo() {
  return (
    <div
      style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 24 }}
    >
      <Slider defaultValue={40} aria-label="Single value" />
      <Slider defaultValue={[20, 70]} valueLabelDisplay="auto" aria-label="Range" />
      <Slider defaultValue={50} step={10} marks min={0} max={100} aria-label="Stepped" />
    </div>
  );
}
