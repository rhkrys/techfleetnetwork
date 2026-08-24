import { useState } from "react";
import { CollapsibleContent, Button, Paper } from "@/design-system";

export default function CollapsibleDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ width: "100%", maxWidth: 340 }}>
      <Button variant="outline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} details
      </Button>
      <CollapsibleContent open={open}>
        <Paper elevation={2} style={{ padding: 12, marginTop: 8 }}>
          This content collapses and expands with a height transition.
        </Paper>
      </CollapsibleContent>
    </div>
  );
}
