/**
 * Select (molecule). Replaces src/components/ui/select.tsx.
 *
 * NOTE: shadcn used a Radix compound API
 * (Select/SelectTrigger/SelectValue/SelectContent/SelectItem). MUI Select is a
 * single control whose options are its `SelectItem` (= MUI MenuItem) children.
 * Migration flattens the compound structure:
 *   <Select value={v} onValueChange={setV}>
 *     <SelectItem value="a">A</SelectItem>
 *   </Select>
 * (`onValueChange` is provided as a convenience alongside MUI's `onChange`.)
 * Pair with `<Label>`/`<Field>` for the label + placeholder.
 * See docs/design/design-system/components/molecules/Select.md
 */
import MuiSelect, { type SelectProps as MuiSelectProps } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";

export interface SelectProps extends Omit<MuiSelectProps, "onChange"> {
  /** Convenience: fires with the new value string (shadcn parity). */
  onValueChange?: (value: string) => void;
}

export function Select({ onValueChange, size = "small", fullWidth = true, ...props }: SelectProps) {
  const handleChange: NonNullable<MuiSelectProps["onChange"]> = (event) => {
    onValueChange?.(event.target.value as string);
  };
  // MUI Select is generic (Select<Value>); merge + cast once so the wrapper's
  // props don't fight generic inference on spread.
  const merged = { size, fullWidth, onChange: handleChange, ...props } as MuiSelectProps;
  return <MuiSelect {...merged} />;
}

export const SelectItem = MenuItem;
