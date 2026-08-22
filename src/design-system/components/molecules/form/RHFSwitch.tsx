/**
 * RHFSwitch (molecule) — react-hook-form-bound switch + inline label.
 * See components/molecules/form/README.md
 */
import { useController, type Control, type FieldValues, type Path } from "react-hook-form";
import { Switch } from "../../atoms/Switch";
import { Label } from "../../atoms/Label";

export interface RHFSwitchProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  label?: string;
  disabled?: boolean;
}

export function RHFSwitch<T extends FieldValues>({
  name,
  control,
  label,
  disabled,
}: RHFSwitchProps<T>) {
  const { field } = useController({ name, control });
  const id = `rhf-${name}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <Switch
        id={id}
        checked={!!field.value}
        onChange={(e) => field.onChange(e.target.checked)}
        onBlur={field.onBlur}
        inputRef={field.ref}
        disabled={disabled}
      />
      {label != null && <Label htmlFor={id}>{label}</Label>}
    </div>
  );
}
