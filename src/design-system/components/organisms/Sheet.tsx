/**
 * Sheet (organism) — side drawer panel. Replaces src/components/ui/sheet.tsx.
 *
 * Keeps the shadcn compound API (Sheet + Trigger/Content/Header/Footer/Title/
 * Description/Close, open/onOpenChange, `side`) via a small open-state context,
 * backed by MUI Drawer (focus management + Escape-to-close for free). Supports
 * controlled (`open`) and uncontrolled (`defaultOpen`) use.
 * See docs/design/design-system/components/organisms/Sheet.md
 */
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useState,
  type ReactNode,
} from "react";
import MuiDrawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import { Text } from "../atoms/Text";
import { Button, type ButtonProps } from "../atoms/Button";

type Side = "top" | "bottom" | "left" | "right";
interface Ctx {
  open: boolean;
  setOpen: (b: boolean) => void;
}
const SheetCtx = createContext<Ctx | null>(null);
const useSheet = () => {
  const c = useContext(SheetCtx);
  if (!c) throw new Error("Sheet.* must be used within <Sheet>");
  return c;
};

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function Sheet({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
}: SheetProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (b: boolean) => {
    if (controlled == null) setInternal(b);
    onOpenChange?.(b);
  };
  return <SheetCtx.Provider value={{ open, setOpen }}>{children}</SheetCtx.Provider>;
}

export function SheetTrigger({ children }: { children: ReactNode }) {
  const { setOpen } = useSheet();
  if (Children.count(children) === 1 && isValidElement(children)) {
    return cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
      onClick: () => setOpen(true),
    });
  }
  return <>{children}</>;
}

export function SheetContent({ side = "right", children }: { side?: Side; children: ReactNode }) {
  const { open, setOpen } = useSheet();
  const width = side === "left" || side === "right" ? { xs: "100vw", sm: 400 } : undefined;
  return (
    <MuiDrawer anchor={side} open={open} onClose={() => setOpen(false)}>
      <Box
        sx={{ width, maxWidth: "100vw", p: 6, display: "flex", flexDirection: "column", gap: 4 }}
      >
        {children}
      </Box>
    </MuiDrawer>
  );
}

export const SheetHeader = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>{children}</div>
);
export const SheetFooter = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "auto" }}>
    {children}
  </div>
);
export const SheetTitle = ({ children }: { children: ReactNode }) => (
  <Text brand="cardTitle" as="h2">
    {children}
  </Text>
);
export const SheetDescription = ({ children }: { children: ReactNode }) => (
  <Text brand="bodySmall" color="muted">
    {children}
  </Text>
);

export function SheetClose({
  variant = "ghost",
  onClick,
  children = "Close",
  ...props
}: ButtonProps) {
  const { setOpen } = useSheet();
  return (
    <Button
      variant={variant}
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
