/**
 * Text (atom) — the typography system. One component replaces the 11 exports
 * of src/components/ui/typography.tsx. Wraps MUI Typography's NATIVE variants
 * with brand names + the correct semantic tag + token colors.
 * See docs/design/design-system/typography-system.md
 */
import { forwardRef, type ElementType } from "react";
import MuiTypography, { type TypographyProps } from "@mui/material/Typography";

export type TextBrand =
  | "display"
  | "pageTitle"
  | "sectionTitle"
  | "subsectionTitle"
  | "cardTitle"
  | "eyebrow"
  | "lede"
  | "label"
  | "body"
  | "bodySmall"
  | "caption";

type MuiVariant = NonNullable<TypographyProps["variant"]>;

const BRAND_TO_VARIANT: Record<TextBrand, MuiVariant> = {
  display: "h1",
  pageTitle: "h2",
  sectionTitle: "h3",
  subsectionTitle: "h4",
  cardTitle: "h5",
  eyebrow: "h6",
  lede: "subtitle1",
  label: "subtitle2",
  body: "body1",
  bodySmall: "body2",
  caption: "caption",
};

const BRAND_TO_TAG: Record<TextBrand, ElementType> = {
  display: "h1",
  pageTitle: "h1", // visual h2, semantic h1 by default (one <h1> per page)
  sectionTitle: "h2",
  subsectionTitle: "h3",
  cardTitle: "h4",
  eyebrow: "span",
  lede: "p",
  label: "span",
  body: "p",
  bodySmall: "p",
  caption: "span",
};

const COLOR_SX = {
  default: { color: "text.primary" },
  muted: { color: "text.secondary" },
  primary: { color: "primary.main" },
} as const;

export interface TextProps extends Omit<TypographyProps, "variant" | "color"> {
  brand?: TextBrand;
  color?: keyof typeof COLOR_SX;
  /** Override the semantic tag (e.g. render a pageTitle as <h1> or <h2>). */
  as?: ElementType;
}

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { brand = "body", color = "default", as, sx, ...props },
  ref
) {
  return (
    <MuiTypography
      ref={ref}
      variant={BRAND_TO_VARIANT[brand]}
      component={as ?? BRAND_TO_TAG[brand]}
      sx={[COLOR_SX[color], ...(Array.isArray(sx) ? sx : [sx])]}
      {...props}
    />
  );
});
