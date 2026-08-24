import { useState } from "react";
import { Menu, MenuItem, Button } from "@/design-system";

export default function MenuDemo() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const close = () => setAnchorEl(null);
  return (
    <>
      <Button onClick={(e) => setAnchorEl(e.currentTarget)}>Open menu</Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        <MenuItem onClick={close}>Profile</MenuItem>
        <MenuItem onClick={close}>My account</MenuItem>
        <MenuItem onClick={close}>Log out</MenuItem>
      </Menu>
    </>
  );
}
