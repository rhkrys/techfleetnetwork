/**
 * TFDS typography — the Tech Fleet type scale wrapped onto MUI's NATIVE
 * variant layer (h1–h6, subtitle1/2, body1/2, button, caption, overline).
 * Futura headings, Poppins body + labels. No Roboto, no monospace face.
 * Full spec: docs/design/design-system/typography-system.md
 */
import type { ThemeOptions } from "@mui/material/styles";
import { FONT_BODY, FONT_HEADING } from "./tokens";

const heading = (fontWeight: number, fontSize: string, lineHeight = 1.1) => ({
  fontFamily: FONT_HEADING,
  fontWeight,
  lineHeight,
  letterSpacing: "0.012em",
  fontSize,
});

export const typography: ThemeOptions["typography"] = {
  fontFamily: FONT_BODY, // default → Poppins (replaces MUI's Roboto)
  htmlFontSize: 16,

  // Headings — Futura
  h1: heading(700, "clamp(1.875rem, 4vw, 3rem)", 1.0), // Display / Hero (64)
  h2: heading(700, "clamp(1.5rem, 3vw, 2.25rem)"), // Page Title (48)
  h3: heading(700, "clamp(1.25rem, 2.25vw, 1.75rem)"), // Section (36)
  h4: heading(700, "clamp(1.25rem, 2vw, 1.5rem)"), // Subsection (24)
  h5: heading(500, "clamp(1.125rem, 1.5vw, 1.25rem)"), // Card Title (20)
  h6: heading(600, "1rem", 1.2), // Eyebrow / micro-heading (16)

  // Body & labels — Poppins (inherit default fontFamily)
  subtitle1: { fontWeight: 400, lineHeight: 1.5, fontSize: "1.125rem" }, // Lede (18)
  subtitle2: { fontWeight: 500, lineHeight: 1.4, fontSize: "0.875rem" }, // Label (14)
  body1: { fontWeight: 400, lineHeight: 1.5, fontSize: "1rem" }, // Body (16)
  body2: { fontWeight: 400, lineHeight: 1.5, fontSize: "0.875rem" }, // Body Small (14)
  caption: { fontWeight: 400, lineHeight: 1.5, fontSize: "0.75rem" }, // Caption (12)
  button: { fontWeight: 700, letterSpacing: "1px", textTransform: "none", fontSize: "1rem" },
  overline: {
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: "0.75rem",
    lineHeight: 1.5,
  },
};
