import { Field, Input } from "@/design-system";

export default function FieldDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 300 }}>
      <Field label="Display name" htmlFor="field-demo-name" helperText="Shown on your profile.">
        <Input id="field-demo-name" defaultValue="Ada" />
      </Field>
      <Field label="Email" htmlFor="field-demo-email" required error="Enter a valid email address.">
        <Input id="field-demo-email" defaultValue="not-an-email" />
      </Field>
    </div>
  );
}
