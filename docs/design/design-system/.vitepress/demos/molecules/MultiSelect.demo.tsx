import { useState } from "react";
import { MultiSelect } from "@/design-system";

const options = [
  { value: "react", label: "React" },
  { value: "ts", label: "TypeScript" },
  { value: "node", label: "Node.js" },
  { value: "sql", label: "SQL" },
];

export default function MultiSelectDemo() {
  const [selected, setSelected] = useState<string[]>(["react", "ts"]);
  return (
    <div style={{ width: 300 }}>
      <MultiSelect label="Skills" options={options} selected={selected} onChange={setSelected} />
    </div>
  );
}
