/**
 * Drawer (organism). Replaces src/components/ui/drawer.tsx (vaul).
 * MUI Drawer — controlled `open`/`onClose`, `anchor` side. For the compound
 * side-panel API with a trigger, use `Sheet`.
 * See docs/design/design-system/components/organisms/Drawer.md
 */
import MuiDrawer, { type DrawerProps } from "@mui/material/Drawer";

export function Drawer({ anchor = "bottom", ...props }: DrawerProps) {
  return <MuiDrawer anchor={anchor} {...props} />;
}

export type { DrawerProps };
