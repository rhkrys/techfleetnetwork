/**
 * Card (molecule) — the Tech Fleet .tf-card surface + sub-parts.
 * Replaces src/components/ui/card.tsx. The 40px asymmetric radius + inset glow
 * come from the theme (MuiCard styleOverrides); variants tweak the shell.
 * See docs/design/design-system/components/molecules/Card.md
 */
import { forwardRef, type ReactNode } from "react";
import MuiCard, { type CardProps as MuiCardProps } from "@mui/material/Card";
import Box, { type BoxProps } from "@mui/material/Box";
import { Text } from "../atoms/Text";

export type CardVariant = "default" | "muted" | "compact";

export interface CardProps extends Omit<MuiCardProps, "variant"> {
  variant?: CardVariant;
}

const VARIANT_SX: Record<CardVariant, object> = {
  default: {},
  muted: { backgroundColor: "action.hover" },
  compact: { borderTopLeftRadius: 24, borderBottomRightRadius: 24 },
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", sx, ...props },
  ref
) {
  return (
    <MuiCard ref={ref} sx={[VARIANT_SX[variant], ...(Array.isArray(sx) ? sx : [sx])]} {...props} />
  );
});

export const CardHeader = (props: BoxProps) => (
  <Box {...props} sx={{ display: "flex", flexDirection: "column", gap: 0.75, p: 3, ...props.sx }} />
);

export const CardContent = (props: BoxProps) => (
  <Box {...props} sx={{ p: 3, pt: 0, ...props.sx }} />
);

export const CardFooter = (props: BoxProps) => (
  <Box {...props} sx={{ display: "flex", alignItems: "center", p: 3, pt: 0, ...props.sx }} />
);

export const CardTitle = ({
  children,
  as,
}: {
  children: ReactNode;
  as?: "h2" | "h3" | "h4" | "h5" | "h6";
}) => (
  <Text brand="cardTitle" as={as ?? "h4"}>
    {children}
  </Text>
);

export const CardDescription = ({ children }: { children: ReactNode }) => (
  <Text brand="subsectionTitle" color="muted" as="p">
    {children}
  </Text>
);
