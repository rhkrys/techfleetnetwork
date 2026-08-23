import { useState } from "react";
import { Backdrop, Button, CircularProgress } from "@/design-system";

export default function BackdropDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show backdrop</Button>
      <Backdrop
        open={open}
        onClick={() => setOpen(false)}
        sx={{ color: "#fff", zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </>
  );
}
