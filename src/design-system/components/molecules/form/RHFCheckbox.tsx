/**
 * RHFCheckbox (molecule) — react-hook-form-bound checkbox + inline label.
 * See components/molecules/form/README.md
 */
import { useController, type Control, type FieldValues, type Path } from "react-hook-form";
import { Checkbox } from "../../atoms/Checkbox";
import { Label } from "../../atoms/Label";
import { Text } from "../../atoms/Text";

export interface RHFCheckboxProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  label?: string;
  disabled?: boolean;
}

export function RHFCheckbox<T extends FieldValues>({
  name,
  control,
  label,
  disabled,
}: RHFCheckboxProps<T>) {
  const { field, fieldState } = useController({ name, control });
  const id = `rhf-${name}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Checkbox
          id={id}
          checked={!!field.value}
          onChange={(e) => field.onChange(e.target.checked)}
          onBlur={field.onBlur}
          inputRef={field.ref}
          disabled={disabled}
        />
        {label != null && <Label htmlFor={id}>{label}</Label>}
      </div>
      {fieldState.error?.message && (
        <Text brand="caption" sx={{ color: "error.main" }}>
          {fieldState.error.message}
        </Text>
      )}
    </div>
  );
}
