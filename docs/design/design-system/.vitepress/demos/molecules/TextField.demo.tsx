import { TextField } from "@/design-system";

export default function TextFieldDemo() {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 280 }}
    >
      <TextField label="Full name" />
      <TextField label="Email" defaultValue="me@techfleet.org" helperText="We never share it." />
      <TextField label="Password" type="password" error helperText="Required" />
      <TextField label="Bio" multiline rows={3} placeholder="Tell us about yourself" />
    </div>
  );
}
