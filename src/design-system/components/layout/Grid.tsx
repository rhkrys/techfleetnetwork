/**
 * Grid (layout) — the 12-column, fully responsive layout primitive.
 * MUI Grid (v2): a 12-column grid whose column spans are set per breakpoint via
 * `size`, and whose gutters are on the 4px spacing grid via `spacing`.
 *
 * Responsive by construction (universal-browser-device-support): mobile-first,
 * fluid, no fixed pixel widths. Use `size={{ xs: 12, sm: 6, md: 4 }}` etc.
 * See docs/design/design-system/responsive-and-accessibility.md
 *
 * @example
 * <Grid container spacing={4}>
 *   <Grid size={{ xs: 12, md: 6 }}>left</Grid>
 *   <Grid size={{ xs: 12, md: 6 }}>right</Grid>
 * </Grid>
 */
import MuiGrid, { type GridProps } from "@mui/material/Grid";

export function Grid(props: GridProps) {
  return <MuiGrid {...props} />;
}

export type { GridProps };
