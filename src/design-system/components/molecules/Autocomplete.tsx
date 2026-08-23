/**
 * Autocomplete + MultiSelect (molecule). Replaces src/components/ui/multi-select.tsx.
 * MUI Autocomplete — searchable single/multi select with chips. A big
 * simplification over the shadcn Popover+Command composite.
 * See docs/design/design-system/components/molecules/Autocomplete.md
 */
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";

export const Autocomplete = MuiAutocomplete;

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  label,
  disabled,
  ...rest
}: MultiSelectProps) {
  const value = options.filter((o) => selected.includes(o.value));
  return (
    <MuiAutocomplete
      multiple
      size="small"
      disabled={disabled}
      options={options}
      value={value}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(o, v) => o.value === v.value}
      getOptionDisabled={(o) => Boolean(o.disabled)}
      onChange={(_e, v) => onChange(v.map((o) => o.value))}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} {...rest} />
      )}
    />
  );
}
