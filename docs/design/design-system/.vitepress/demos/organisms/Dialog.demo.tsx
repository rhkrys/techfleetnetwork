import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogDescription,
  DialogFooter,
  Button,
} from "@/design-system";

export default function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Invite teammates</DialogTitle>
        <DialogContent>
          <DialogDescription>Enter an email to send an invitation.</DialogDescription>
        </DialogContent>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setOpen(false)}>Send invite</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
