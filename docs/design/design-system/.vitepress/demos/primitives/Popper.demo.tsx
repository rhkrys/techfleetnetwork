import { useState } from "react";
import { Popper, Button, Paper } from "@/design-system";

export default function PopperDemo() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  return (
    <>
      <Button onClick={(e) => setAnchorEl(anchorEl ? null : e.currentTarget)}>Toggle popper</Button>
      <Popper open={Boolean(anchorEl)} anchorEl={anchorEl} placement="bottom-start">
        <Paper elevation={3} style={{ padding: 12, marginTop: 8, maxWidth: 240 }}>
          Floating content, positioned next to the anchor — no backdrop, no focus trap.
        </Paper>
      </Popper>
    </>
  );
}
