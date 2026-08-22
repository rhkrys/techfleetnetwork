/**
 * Dialog (organism). Replaces src/components/ui/dialog.tsx.
 *
 * NOTE: MUI Dialog is CONTROLLED (`open` / `onClose`) — there is no
 * DialogTrigger/DialogPortal/DialogClose like the Radix/shadcn compound API.
 * Drive it with your own open state. Sub-parts map to MUI equivalents.
 * See docs/design/design-system/components/organisms/Dialog.md
 */
import type { ReactNode } from "react";
import MuiDialog, { type DialogProps } from "@mui/material/Dialog";
import MuiDialogTitle from "@mui/material/DialogTitle";
import MuiDialogContent from "@mui/material/DialogContent";
import MuiDialogActions from "@mui/material/DialogActions";
import { Text } from "../atoms/Text";

export function Dialog(props: DialogProps) {
  return <MuiDialog {...props} />;
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>{children}</div>
  );
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return (
    <MuiDialogTitle sx={{ px: 0, py: 0 }}>
      <Text brand="cardTitle" as="h2">
        {children}
      </Text>
    </MuiDialogTitle>
  );
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return (
    <Text brand="bodySmall" color="muted">
      {children}
    </Text>
  );
}

export const DialogContent = MuiDialogContent;
export const DialogFooter = MuiDialogActions;

export type { DialogProps };
