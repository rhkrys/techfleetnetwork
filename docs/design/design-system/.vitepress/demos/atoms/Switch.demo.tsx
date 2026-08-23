import { Switch, FormControlLabel } from "@/design-system";

export default function SwitchDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <FormControlLabel control={<Switch defaultChecked />} label="On" />
      <FormControlLabel control={<Switch />} label="Off" />
      <FormControlLabel disabled control={<Switch />} label="Disabled" />
    </div>
  );
}
