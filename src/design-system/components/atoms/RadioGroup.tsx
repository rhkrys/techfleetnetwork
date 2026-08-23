/**
 * RadioGroup (atom). Replaces src/components/ui/radio-group.tsx.
 * MUI RadioGroup + Radio (exported as RadioGroupItem). NOTE: shadcn used
 * `onValueChange`; MUI RadioGroup uses `onChange(event, value)`. Items take a
 * `value` and render a <Radio>. See components/atoms/RadioGroup.md
 */
import MuiRadioGroup, { type RadioGroupProps } from "@mui/material/RadioGroup";
import Radio, { type RadioProps } from "@mui/material/Radio";

export function RadioGroup(props: RadioGroupProps) {
  return <MuiRadioGroup {...props} />;
}

export function RadioGroupItem({ size = "small", ...props }: RadioProps) {
  return <Radio size={size} {...props} />;
}

export type { RadioGroupProps };
