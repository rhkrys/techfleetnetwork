/**
 * Separator (atom) — divider line. Replaces src/components/ui/separator.tsx.
 * MUI Divider (horizontal | vertical). See components/atoms/Separator.md
 */
import Divider, { type DividerProps } from "@mui/material/Divider";

export function Separator(props: DividerProps) {
  return <Divider {...props} />;
}

export type SeparatorProps = DividerProps;
