import { useForm } from "react-hook-form";
import { RHFTextField, RHFCheckbox, RHFSwitch, Button } from "@/design-system";

export default function FormAdaptersDemo() {
  const { control, handleSubmit } = useForm({
    defaultValues: { email: "", subscribe: true, beta: false },
  });
  return (
    <form
      onSubmit={handleSubmit(() => {})}
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 320 }}
    >
      <RHFTextField control={control} name="email" label="Work email" />
      <RHFCheckbox control={control} name="subscribe" label="Email me product updates" />
      <RHFSwitch control={control} name="beta" label="Join the beta program" />
      <Button type="submit" variant="hero">
        Save
      </Button>
    </form>
  );
}
