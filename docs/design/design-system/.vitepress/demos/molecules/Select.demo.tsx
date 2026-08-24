import { useState } from "react";
import { Select, SelectItem } from "@/design-system";

export default function SelectDemo() {
  const [value, setValue] = useState("apple");
  return (
    <Select
      value={value}
      onChange={(e) => setValue(e.target.value as string)}
      aria-label="Fruit"
      style={{ minWidth: 200 }}
    >
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
      <SelectItem value="cherry">Cherry</SelectItem>
    </Select>
  );
}
