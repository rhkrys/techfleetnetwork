import { Input } from "@/design-system";

export default function InputDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 280 }}>
      <Input placeholder="Default input" />
      <Input defaultValue="With a value" />
      <Input placeholder="Disabled" disabled />
      <Input placeholder="Error state" error />
    </div>
  );
}
