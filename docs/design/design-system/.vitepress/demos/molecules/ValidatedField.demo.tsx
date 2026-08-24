import { ValidatedField, Input } from "@/design-system";

export default function ValidatedFieldDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 300 }}>
      <ValidatedField id="vf-name" label="Name" description="Your full name.">
        <Input id="vf-name" defaultValue="Grace Hopper" />
      </ValidatedField>
      <ValidatedField id="vf-code" label="Invite code" required error="That code is invalid.">
        <Input id="vf-code" defaultValue="XXXX" />
      </ValidatedField>
    </div>
  );
}
