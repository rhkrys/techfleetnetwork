import { useState } from "react";
import { Portal, Button } from "@/design-system";

export default function PortalDemo() {
  const [show, setShow] = useState(false);
  return (
    <div>
      <Button onClick={() => setShow((s) => !s)}>Toggle portaled banner</Button>
      {show && (
        <Portal>
          <div
            style={{
              position: "fixed",
              bottom: 16,
              left: 16,
              right: 16,
              padding: 12,
              background: "#0056a7",
              color: "#fff",
              borderRadius: 8,
              zIndex: 3000,
              textAlign: "center",
            }}
          >
            This banner is rendered into <code>document.body</code> via Portal.
          </div>
        </Portal>
      )}
    </div>
  );
}
