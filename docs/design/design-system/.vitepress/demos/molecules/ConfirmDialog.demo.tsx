import { useState } from "react";
import { ConfirmDialog, Button } from "@/design-system";

export default function ConfirmDialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete project?"
        consequence="This permanently removes the project and its data. This cannot be undone."
        actionLabel="Delete"
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}
