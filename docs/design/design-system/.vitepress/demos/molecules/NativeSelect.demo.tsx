import { NativeSelect, FormControl, InputLabel } from "@/design-system";

export default function NativeSelectDemo() {
  return (
    <FormControl style={{ minWidth: 220 }}>
      <InputLabel variant="standard" htmlFor="native-select-demo">
        Role
      </InputLabel>
      <NativeSelect defaultValue="pm" inputProps={{ id: "native-select-demo", name: "role" }}>
        <option value="pm">Product Manager</option>
        <option value="eng">Engineer</option>
        <option value="design">Designer</option>
      </NativeSelect>
    </FormControl>
  );
}
