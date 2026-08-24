import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/design-system";
import FormatAlignLeft from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenter from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRight from "@mui/icons-material/FormatAlignRight";

export default function ToggleGroupDemo() {
  const [align, setAlign] = useState("left");
  return (
    <ToggleGroup
      value={align}
      exclusive
      onChange={(_, v) => v && setAlign(v)}
      aria-label="Alignment"
    >
      <ToggleGroupItem value="left" aria-label="Left">
        <FormatAlignLeft />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Center">
        <FormatAlignCenter />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Right">
        <FormatAlignRight />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
