import { useState } from "react";
import { Rating } from "@/design-system";

export default function RatingDemo() {
  const [value, setValue] = useState<number | null>(3);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Rating value={value} onChange={(_, v) => setValue(v)} />
      <Rating value={2.5} precision={0.5} readOnly />
      <Rating value={4} readOnly size="small" />
    </div>
  );
}
