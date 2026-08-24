import { Autocomplete, TextField } from "@/design-system";

const options = ["React", "Vue", "Svelte", "Angular", "Solid", "Qwik"];

export default function AutocompleteDemo() {
  return (
    <Autocomplete
      options={options}
      style={{ width: 260 }}
      renderInput={(params) => <TextField {...params} label="Framework" />}
    />
  );
}
