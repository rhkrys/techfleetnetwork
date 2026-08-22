/**
 * RHFTextarea (molecule) — react-hook-form-bound multiline field.
 * See components/molecules/form/README.md
 */
import { useController, type Control, type FieldValues, type Path } from "react-hook-form";
import { Field } from "../Field";
import { Textarea } from "../../atoms/Textarea";

export interface RHFTextareaProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  label?: string;
  helperText?: string;
  required?: boolean;
  placeholder?: string;
  minRows?: number;
  disabled?: boolean;
}

export function RHFTextarea<T extends FieldValues>({
  name,
  control,
  label,
  helperText,
  required,
  ...inputProps
}: RHFTextareaProps<T>) {
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
      <Textarea id={id} inputRef={ref} error={!!fieldState.error} {...fieldRest} {...inputProps} />
    </Field>
  );
}
