import { useState } from "react";
import { Modal, Box, Button } from "@/design-system";

export default function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 320,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            boxShadow: 24,
            p: 4,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Modal title</h3>
          <p style={{ marginBottom: 16 }}>
            The low-level overlay primitive. Prefer Dialog for app UI.
          </p>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </Box>
      </Modal>
    </>
  );
}
