import { Checkbox, FormControlLabel } from "@/design-system";

export default function CheckboxDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <FormControlLabel control={<Checkbox defaultChecked />} label="Checked" />
      <FormControlLabel control={<Checkbox />} label="Unchecked" />
      <FormControlLabel control={<Checkbox indeterminate />} label="Indeterminate" />
      <FormControlLabel disabled control={<Checkbox />} label="Disabled" />
    </div>
  );
}
