/**
 * AlertDialog (organism) — confirmation dialog. Replaces src/components/ui/alert-dialog.tsx.
 *
 * Keeps the shadcn compound API (AlertDialog + Trigger/Content/Header/Footer/
 * Title/Description/Action/Cancel, open/onOpenChange) via a small open-state
 * context, backed by MUI Dialog (focus trap + return-focus for free). Supports
 * controlled (`open`) and uncontrolled (`defaultOpen`) use.
 *
 * UX (usability-ux-universal-design): confirmations summarize what will happen;
 * the destructive path uses Button `variant="destructive"`, the safe path is Cancel.
 * See docs/design/design-system/components/organisms/AlertDialog.md
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
import MuiDialog from "@mui/material/Dialog";
import MuiDialogContent from "@mui/material/DialogContent";
import MuiDialogActions from "@mui/material/DialogActions";
import { Text } from "../atoms/Text";
import { Button, type ButtonProps } from "../atoms/Button";

interface Ctx {
  open: boolean;
  setOpen: (b: boolean) => void;
}
const AlertCtx = createContext<Ctx | null>(null);
const useAlert = () => {
  const c = useContext(AlertCtx);
  if (!c) throw new Error("AlertDialog.* must be used within <AlertDialog>");
  return c;
};

export interface AlertDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function AlertDialog({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
}: AlertDialogProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (b: boolean) => {
    if (controlled == null) setInternal(b);
    onOpenChange?.(b);
  };
  return <AlertCtx.Provider value={{ open, setOpen }}>{children}</AlertCtx.Provider>;
}

export function AlertDialogTrigger({ children }: { children: ReactNode }) {
  const { setOpen } = useAlert();
  if (Children.count(children) === 1 && isValidElement(children)) {
    return cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
      onClick: () => setOpen(true),
    });
  }
  return <>{children}</>;
}

export function AlertDialogContent({ children }: { children: ReactNode }) {
  const { open, setOpen } = useAlert();
  return (
    <MuiDialog open={open} onClose={() => setOpen(false)} role="alertdialog">
      <MuiDialogContent>{children}</MuiDialogContent>
    </MuiDialog>
  );
}

export const AlertDialogHeader = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>{children}</div>
);
export const AlertDialogFooter = MuiDialogActions;
export const AlertDialogTitle = ({ children }: { children: ReactNode }) => (
  <Text brand="cardTitle" as="h2">
    {children}
  </Text>
);
export const AlertDialogDescription = ({ children }: { children: ReactNode }) => (
  <Text brand="bodySmall" color="muted">
    {children}
  </Text>
);

/** Confirms the action, then closes. Default variant is `destructive`. */
export function AlertDialogAction({ variant = "destructive", onClick, ...props }: ButtonProps) {
  const { setOpen } = useAlert();
  return (
    <Button
      variant={variant}
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
      {...props}
    />
  );
}

/** Dismisses without acting. */
export function AlertDialogCancel({
  variant = "ghost",
  onClick,
  children = "Cancel",
  ...props
}: ButtonProps) {
  const { setOpen } = useAlert();
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
