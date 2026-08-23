import { useState } from "react";
import { ClickAwayListener, Button, Paper } from "@/design-system";

export default function ClickAwayListenerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <div style={{ position: "relative" }}>
        <Button onClick={() => setOpen((o) => !o)}>Toggle (then click outside)</Button>
        {open && (
          <Paper
            elevation={3}
            style={{ position: "absolute", marginTop: 8, padding: 12, zIndex: 1, width: 220 }}
          >
            Click anywhere outside this panel to close it.
          </Paper>
        )}
      </div>
    </ClickAwayListener>
  );
}
