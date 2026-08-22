/**
 * Label (atom) — form label. Replaces src/components/ui/label.tsx.
 * Poppins 600 / 14px (matches shadcn label). Use `htmlFor` to bind to a field.
 * See docs/design/design-system/components/atoms/Label.md
 */
import { styled } from "@mui/material/styles";

export const Label = styled("label")(({ theme }) => ({
  fontFamily: theme.typography.fontFamily,
  fontSize: "0.875rem",
  fontWeight: 600,
  lineHeight: 1.2,
  color: theme.palette.text.primary,
  display: "inline-block",
}));
