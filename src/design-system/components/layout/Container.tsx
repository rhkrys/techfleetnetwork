/**
 * Container (layout) — responsive, centered max-width page container.
 * MUI Container. Fluid gutters, breakpoint-capped max-width. Default `maxWidth="lg"`.
 * See docs/design/design-system/responsive-and-accessibility.md
 */
import MuiContainer, { type ContainerProps } from "@mui/material/Container";

export function Container({ maxWidth = "lg", ...props }: ContainerProps) {
  return <MuiContainer maxWidth={maxWidth} {...props} />;
}

export type { ContainerProps };
