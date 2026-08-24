/**
 * ScrollArea (atom). Replaces src/components/ui/scroll-area.tsx.
 * MUI has no ScrollArea; this is a themed overflow container. shadcn wrapped a
 * Radix scroll-area with a custom scrollbar — here we use native overflow with a
 * slim themed scrollbar. See components/atoms/ScrollArea.md
 */
import { styled } from "@mui/material/styles";

export const ScrollArea = styled("div")(({ theme }) => ({
  position: "relative",
  overflow: "auto",
  "&::-webkit-scrollbar": { width: 8, height: 8 },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: theme.palette.divider,
    borderRadius: 8,
  },
  scrollbarWidth: "thin",
  scrollbarColor: `${theme.palette.divider} transparent`,
}));

/** Compat no-op: shadcn exported ScrollBar as a separate slot. */
export function ScrollBar() {
  return null;
}
