import { Label, Input } from "@/design-system";

export default function LabelDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 280 }}>
      <Label htmlFor="label-demo-email">Email address</Label>
      <Input id="label-demo-email" type="email" placeholder="you@techfleet.org" />
    </div>
  );
}
