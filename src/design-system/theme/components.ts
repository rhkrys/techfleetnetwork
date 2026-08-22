/**
 * TFDS component style-overrides — re-expresses the Tech Fleet brand skin
 * (currently Tailwind classes + global CSS in index.css) as MUI theme overrides.
 * Covers Phase-0 proof components: Button (9 variants, asymmetric radius,
 * --tf-btn shadows, no ripple) and Card (.tf-card 40px asymmetric radius + glow).
 */
import type { Components, Theme } from "@mui/material/styles";
import type { Mode, ModeTokens } from "./tokens";

// Asymmetric radius: top-left + bottom-right only (Tech Fleet signature).
// CSS shorthand order: top-left top-right bottom-right bottom-left.
const ASYM_RADIUS = "6px 0 6px 0";

const statTokens = (mode: Mode) =>
  mode === "light"
    ? {
        border: "hsl(209, 100%, 33%)",
        bg: "rgba(0, 86, 167, 0.05)",
        glow1: "rgba(0, 86, 167, 0.20)",
        glow2: "rgba(0, 86, 167, 0.28)",
      }
    : {
        border: "#f4f6ff",
        bg: "rgba(77, 140, 255, 0.05)",
        glow1: "rgba(112, 207, 255, 0.30)",
        glow2: "rgba(112, 207, 255, 0.40)",
      };

export function components(mode: Mode, t: ModeTokens): Components<Theme> {
  const filledHover = { transform: "translateY(-1px)", boxShadow: t.btn.shadowHover };
  const stat = statTokens(mode);

  return {
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, variant: "default" },
      styleOverrides: {
        root: {
          minHeight: 40,
          height: 40,
          padding: "0 30px",
          borderRadius: ASYM_RADIUS,
          textTransform: "none",
          fontWeight: 700,
          letterSpacing: "1px",
          fontSize: "1rem",
          lineHeight: 1,
          transition: "all 200ms",
          "& svg": { width: 16, height: 16, flexShrink: 0 },
        },
      },
      variants: [
        {
          props: { variant: "default" },
          style: {
            backgroundColor: t.btn.primaryBg,
            color: t.btn.primaryFg,
            boxShadow: t.btn.shadow,
            "&:hover": { backgroundColor: t.btn.primaryBg, ...filledHover },
          },
        },
        {
          props: { variant: "hero" },
          style: {
            backgroundColor: t.btn.primaryBg,
            color: t.btn.primaryFg,
            boxShadow: t.btn.shadow,
            "&:hover": { backgroundColor: "#4d8cff", ...filledHover },
          },
        },
        {
          props: { variant: "success" },
          style: {
            backgroundColor: t.success.main,
            color: t.success.contrastText,
            boxShadow: t.btn.shadow,
            "&:hover": { backgroundColor: t.success.main, ...filledHover },
          },
        },
        {
          props: { variant: "destructive" },
          style: {
            backgroundColor: t.error.main,
            color: t.error.contrastText,
            boxShadow: t.btn.shadow,
            "&:hover": { backgroundColor: t.error.main, ...filledHover },
          },
        },
        {
          props: { variant: "outline" },
          style: {
            backgroundColor: t.btn.secondaryBg,
            color: t.btn.secondaryFg,
            border: `1px solid ${t.btn.secondaryBorder}`,
            "&:hover": { backgroundColor: t.btn.secondaryBgHover },
          },
        },
        {
          props: { variant: "secondary" },
          style: {
            backgroundColor: t.btn.secondaryBg,
            color: t.btn.secondaryFg,
            border: `1px solid ${t.btn.secondaryBorder}`,
            "&:hover": { backgroundColor: t.btn.secondaryBgHover },
          },
        },
        {
          props: { variant: "hero-outline" },
          style: {
            backgroundColor: t.btn.secondaryBg,
            color: t.btn.secondaryFg,
            border: `1px solid ${t.btn.secondaryBorder}`,
            "&:hover": { backgroundColor: t.btn.secondaryBgHover },
          },
        },
        {
          props: { variant: "ghost" },
          style: {
            borderRadius: "6px",
            backgroundColor: "transparent",
            color: t.textPrimary,
            boxShadow: "none",
            "&:hover": { backgroundColor: t.secondary.main, color: t.secondary.contrastText },
          },
        },
        {
          props: { variant: "link" },
          style: {
            borderRadius: 0,
            padding: 0,
            height: "auto",
            minHeight: 0,
            backgroundColor: "transparent",
            color: t.primary.main,
            boxShadow: "none",
            textUnderlineOffset: "4px",
            "&:hover": { backgroundColor: "transparent", textDecoration: "underline" },
          },
        },
      ],
    },
    MuiPaper: {
      styleOverrides: {
        // Do NOT apply tf-card to Paper globally (menus/popovers/dialogs use it).
        root: { backgroundImage: "none" },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: stat.bg,
          border: `3px solid ${stat.border}`,
          borderTopLeftRadius: 40,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 40,
          borderBottomLeftRadius: 0,
          boxShadow: `inset 5px 5px 20px 3px ${stat.glow1}, inset -5px -5px 20px 5px ${stat.glow2}`,
          color: t.textPrimary,
          position: "relative",
          overflow: "hidden",
          backgroundImage: "none",
        },
      },
    },
  };
}
