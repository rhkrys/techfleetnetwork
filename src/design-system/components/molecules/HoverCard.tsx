/**
 * HoverCard (molecule). Replaces src/components/ui/hover-card.tsx.
 * Keeps the shadcn compound API (HoverCard/HoverCardTrigger/HoverCardContent)
 * via an anchor context, backed by MUI Popover opened on hover/focus. Content is
 * also reachable by keyboard focus (no hover-only affordance — a11y/device rule).
 * See docs/design/design-system/components/molecules/HoverCard.md
 */
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import MuiPopover from "@mui/material/Popover";
import Box from "@mui/material/Box";

interface Ctx {
  anchorEl: HTMLElement | null;
  open: (el: HTMLElement) => void;
  close: () => void;
}
const HoverCtx = createContext<Ctx | null>(null);
const useHover = () => {
  const c = useContext(HoverCtx);
  if (!c) throw new Error("HoverCard.* must be used within <HoverCard>");
  return c;
};

export function HoverCard({ children }: { children: ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <HoverCtx.Provider
      value={{ anchorEl, open: (el) => setAnchorEl(el), close: () => setAnchorEl(null) }}
    >
      {children}
    </HoverCtx.Provider>
  );
}

export function HoverCardTrigger({ children }: { children: ReactNode }) {
  const { open, close } = useHover();
  if (Children.count(children) === 1 && isValidElement(children)) {
    return cloneElement(
      children as React.ReactElement<{
        onMouseEnter?: (e: SyntheticEvent<HTMLElement>) => void;
        onMouseLeave?: () => void;
        onFocus?: (e: SyntheticEvent<HTMLElement>) => void;
        onBlur?: () => void;
      }>,
      {
        onMouseEnter: (e: SyntheticEvent<HTMLElement>) => open(e.currentTarget),
        onMouseLeave: () => close(),
        onFocus: (e: SyntheticEvent<HTMLElement>) => open(e.currentTarget),
        onBlur: () => close(),
      }
    );
  }
  return <>{children}</>;
}

export function HoverCardContent({ children }: { children: ReactNode }) {
  const { anchorEl, close } = useHover();
  return (
    <MuiPopover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={close}
      sx={{ pointerEvents: "none" }}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      disableRestoreFocus
    >
      <Box sx={{ p: 4, maxWidth: "min(92vw, 320px)" }}>{children}</Box>
    </MuiPopover>
  );
}
