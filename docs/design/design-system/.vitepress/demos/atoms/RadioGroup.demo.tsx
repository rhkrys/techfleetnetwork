import { useState } from "react";
import { RadioGroup, RadioGroupItem, FormControlLabel } from "@/design-system";

export default function RadioGroupDemo() {
  const [value, setValue] = useState("standard");
  return (
    <RadioGroup value={value} onChange={(_, v) => setValue(v)}>
      <FormControlLabel value="standard" control={<RadioGroupItem />} label="Standard" />
      <FormControlLabel value="priority" control={<RadioGroupItem />} label="Priority" />
      <FormControlLabel value="express" control={<RadioGroupItem />} label="Express" />
    </RadioGroup>
  );
}
