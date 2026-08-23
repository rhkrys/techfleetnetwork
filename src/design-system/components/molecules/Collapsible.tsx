/**
 * Collapsible (molecule). Replaces src/components/ui/collapsible.tsx.
 * MUI Collapse. NOTE: shadcn/Radix was trigger-based (Collapsible/CollapsibleTrigger/
 * CollapsibleContent with open/onOpenChange). MUI Collapse is controlled via `in`.
 * The DS `Collapsible` takes `open`; `CollapsibleContent` renders the collapse.
 * See components/molecules/Collapsible.md
 */
import type { ReactNode } from "react";
import Collapse from "@mui/material/Collapse";

export function Collapsible({ children }: { open?: boolean; children: ReactNode }) {
  return <div>{children}</div>;
}
export const CollapsibleTrigger = ({ children }: { children: ReactNode }) => <>{children}</>;
export const CollapsibleContent = ({ open, children }: { open?: boolean; children: ReactNode }) => (
  <Collapse in={open}>{children}</Collapse>
);
