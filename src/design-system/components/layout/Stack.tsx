/**
 * Stack (layout) — 1-D flex layout with spacing on the 4px grid.
 * MUI Stack. `direction` and `spacing` accept responsive objects, e.g.
 * `direction={{ xs: "column", md: "row" }}` for input-agnostic reflow.
 * See docs/design/design-system/responsive-and-accessibility.md
 */
import MuiStack, { type StackProps } from "@mui/material/Stack";

export function Stack(props: StackProps) {
  return <MuiStack {...props} />;
}

export type { StackProps };
