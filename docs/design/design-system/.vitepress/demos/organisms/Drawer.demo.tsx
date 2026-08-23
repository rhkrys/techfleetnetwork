import { useState } from "react";
import { Drawer, Button } from "@/design-system";

export default function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open drawer</Button>
      <Drawer open={open} onClose={() => setOpen(false)}>
        <div style={{ width: 260, padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>Navigation</h3>
          <p style={{ marginBottom: 16 }}>A side panel for navigation or details.</p>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </div>
      </Drawer>
    </>
  );
}
