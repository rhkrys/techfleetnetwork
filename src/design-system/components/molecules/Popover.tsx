/**
 * Popover (molecule). Replaces src/components/ui/popover.tsx.
 * Keeps the shadcn compound API (Popover/PopoverTrigger/PopoverContent) via an
 * anchor context, backed by MUI Popover (focus + Escape-to-close for free).
 * See docs/design/design-system/components/molecules/Popover.md
 */
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import MuiPopover, { type PopoverProps as MuiPopoverProps } from "@mui/material/Popover";
import Box from "@mui/material/Box";

interface Ctx {
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
}
const PopCtx = createContext<Ctx | null>(null);
const usePop = () => {
  const c = useContext(PopCtx);
  if (!c) throw new Error("Popover.* must be used within <Popover>");
  return c;
};

export function Popover({ children }: { children: ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return <PopCtx.Provider value={{ anchorEl, setAnchorEl }}>{children}</PopCtx.Provider>;
}

export function PopoverTrigger({ children }: { children: ReactNode }) {
  const { setAnchorEl } = usePop();
  if (Children.count(children) === 1 && isValidElement(children)) {
    return cloneElement(
      children as React.ReactElement<{ onClick?: (e: MouseEvent<HTMLElement>) => void }>,
      {
        onClick: (e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget),
      }
    );
  }
  return <>{children}</>;
}

export function PopoverContent({
  children,
  ...rest
}: { children: ReactNode } & Partial<MuiPopoverProps>) {
  const { anchorEl, setAnchorEl } = usePop();
  return (
    <MuiPopover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={() => setAnchorEl(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      {...rest}
    >
      <Box sx={{ p: 4, maxWidth: "min(92vw, 360px)" }}>{children}</Box>
    </MuiPopover>
  );
}
