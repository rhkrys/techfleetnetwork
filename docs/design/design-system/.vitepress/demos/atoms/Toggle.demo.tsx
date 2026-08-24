import { useState } from "react";
import { Toggle } from "@/design-system";
import FormatBold from "@mui/icons-material/FormatBold";

export default function ToggleDemo() {
  const [bold, setBold] = useState(false);
  return (
    <Toggle value="bold" selected={bold} onChange={() => setBold((b) => !b)} aria-label="Bold">
      <FormatBold />
    </Toggle>
  );
}
