import { useState } from "react";
import { Radio, FormControlLabel } from "@/design-system";

export default function RadioDemo() {
  const [value, setValue] = useState("a");
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <FormControlLabel
        control={<Radio checked={value === "a"} onChange={() => setValue("a")} />}
        label="Option A"
      />
      <FormControlLabel
        control={<Radio checked={value === "b"} onChange={() => setValue("b")} />}
        label="Option B"
      />
      <FormControlLabel disabled control={<Radio />} label="Disabled" />
    </div>
  );
}
