/**
 * Badge (atom) — small pill label. Replaces src/components/ui/badge.tsx.
 * 4 variants matching shadcn (default/secondary/destructive/outline).
 * See docs/design/design-system/components/atoms/Badge.md
 */
import { styled } from "@mui/material/styles";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const Badge = styled("span", {
  shouldForwardProp: (prop) => prop !== "variant",
})<{ variant?: BadgeVariant }>(({ theme, variant = "default" }) => {
  const variants: Record<BadgeVariant, object> = {
    default: {
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
    },
    secondary: {
      backgroundColor: theme.palette.secondary.main,
      color: theme.palette.secondary.contrastText,
    },
    destructive: {
      backgroundColor: theme.palette.error.main,
      color: theme.palette.error.contrastText,
    },
    outline: { color: theme.palette.text.primary, borderColor: theme.palette.divider },
  };
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 9999,
    padding: "2px 10px",
    fontFamily: theme.typography.fontFamily,
    fontSize: "0.75rem",
    fontWeight: 600,
    lineHeight: 1.3,
    border: "1px solid transparent",
    transition: "background-color 150ms",
    ...variants[variant],
  };
});
