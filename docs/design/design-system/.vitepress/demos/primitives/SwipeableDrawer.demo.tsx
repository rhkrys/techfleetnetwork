import { useState } from "react";
import { SwipeableDrawer, Button } from "@/design-system";

export default function SwipeableDrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open swipeable drawer</Button>
      <SwipeableDrawer
        anchor="right"
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
      >
        <div style={{ width: 260, padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>Drawer</h3>
          <p style={{ marginBottom: 16 }}>Swipe (on touch) or click the backdrop to close.</p>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </div>
      </SwipeableDrawer>
    </>
  );
}
