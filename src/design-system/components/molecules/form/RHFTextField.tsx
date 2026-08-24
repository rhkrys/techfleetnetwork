/**
 * RHFTextField (molecule) — react-hook-form-bound text field.
 * Composes Field + Input via useController. Replaces the Radix-Slot form.tsx
 * wiring (incompatible with MUI). See components/molecules/form/README.md
 */
import { useController, type Control, type FieldValues, type Path } from "react-hook-form";
import { Field } from "../Field";
import { Input } from "../../atoms/Input";

export interface RHFTextFieldProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  label?: string;
  helperText?: string;
  required?: boolean;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  minRows?: number;
  disabled?: boolean;
}

export function RHFTextField<T extends FieldValues>({
  name,
  control,
  label,
  helperText,
  required,
  ...inputProps
}: RHFTextFieldProps<T>) {
  const { field, fieldState } = useController({ name, control });
  const { ref, ...fieldRest } = field;
  const id = `rhf-${name}`;
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={fieldState.error?.message}
      helperText={helperText}
    >
      <Input id={id} inputRef={ref} error={!!fieldState.error} {...fieldRest} {...inputProps} />
    </Field>
  );
}
