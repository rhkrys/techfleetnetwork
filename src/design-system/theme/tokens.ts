/**
 * TFDS design tokens — the brand values, per color mode.
 *
 * WHY real hsl() values here (and not `hsl(var(--token))`): MUI's color
 * manipulation (alpha(), lighten/darken used internally by Button/Checkbox/etc.)
 * calls decomposeColor() on palette intention colors and CANNOT parse a CSS
 * `var(...)` reference — it throws at render time. So the palette must hold
 * parseable color strings. We therefore MIRROR the token values from
 * `src/index.css` here (same Tech Fleet Brand Visual Guide numbers), and the
 * theme is rebuilt per mode by DesignSystemProvider.
 *
 * Source of truth during coexistence: `src/index.css` (drives Tailwind/shadcn).
 * Keep these in sync until Tailwind is removed, at which point this file becomes
 * the single source of truth. See docs/design/design-system/architecture-spec.md §3.
 */

export type Mode = "light" | "dark";

/** Comma-form hsl so MUI's decomposeColor parses it reliably. */
const hsl = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;

export interface ModeTokens {
  background: string;
  paper: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  primary: { main: string; dark: string; contrastText: string };
  secondary: { main: string; contrastText: string };
  error: { main: string; contrastText: string };
  success: { main: string; contrastText: string };
  warning: { main: string; contrastText: string };
  ring: string;
  /** Tech Fleet partner-page button skin (verbatim from index.css --tf-btn-*). */
  btn: {
    primaryBg: string;
    primaryFg: string;
    secondaryBg: string;
    secondaryFg: string;
    secondaryBorder: string;
    secondaryBgHover: string;
    shadow: string;
    shadowHover: string;
  };
}

const BTN_SHADOW =
  "0.398096px 0.398096px 0.562993px -0.9375px rgba(0,0,0,0.18), 1.20725px 1.20725px 1.70731px -1.875px rgba(0,0,0,0.17), 3.19133px 3.19133px 4.51322px -2.8125px rgba(0,0,0,0.15), 10px 10px 14.1421px -3.75px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.25)";
const BTN_SHADOW_HOVER =
  "0.5px 0.5px 0.7px -0.94px rgba(0,0,0,0.22), 1.5px 1.5px 2.1px -1.88px rgba(0,0,0,0.20), 4px 4px 5.6px -2.81px rgba(0,0,0,0.18), 14px 14px 20px -3.75px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.30)";

export const LIGHT: ModeTokens = {
  background: hsl(0, 0, 100),
  paper: hsl(0, 0, 100),
  textPrimary: hsl(0, 0, 13),
  textSecondary: hsl(0, 0, 36),
  divider: hsl(0, 0, 88),
  primary: { main: hsl(209, 100, 33), dark: hsl(217, 73, 48), contrastText: hsl(0, 0, 100) },
  secondary: { main: hsl(0, 0, 96), contrastText: hsl(0, 0, 13) },
  error: { main: hsl(13, 84, 41), contrastText: hsl(0, 0, 100) },
  success: { main: hsl(110, 39, 34), contrastText: hsl(0, 0, 100) },
  warning: { main: hsl(38, 92, 50), contrastText: hsl(0, 0, 100) },
  ring: hsl(209, 100, 33),
  btn: {
    primaryBg: hsl(209, 100, 33),
    primaryFg: "#f4f6ff",
    secondaryBg: "#ffffff",
    secondaryFg: hsl(209, 100, 33),
    secondaryBorder: hsl(209, 100, 33),
    secondaryBgHover: "hsla(209, 100%, 33%, 0.12)",
    shadow: BTN_SHADOW,
    shadowHover: BTN_SHADOW_HOVER,
  },
};

export const DARK: ModeTokens = {
  background: hsl(229, 93, 6),
  paper: hsl(229, 50, 10),
  textPrimary: hsl(0, 0, 100),
  textSecondary: hsl(0, 0, 100),
  divider: hsl(229, 30, 18),
  primary: { main: hsl(217, 73, 48), dark: hsl(217, 91, 60), contrastText: hsl(0, 0, 100) },
  secondary: { main: hsl(229, 30, 14), contrastText: hsl(0, 0, 100) },
  error: { main: hsl(13, 84, 53), contrastText: hsl(0, 0, 100) },
  success: { main: hsl(110, 45, 48), contrastText: hsl(0, 0, 100) },
  warning: { main: hsl(38, 92, 50), contrastText: hsl(0, 0, 100) },
  ring: hsl(217, 73, 60),
  btn: {
    primaryBg: "#f4f6ff",
    primaryFg: "rgb(51, 51, 51)",
    secondaryBg: "#01061e",
    secondaryFg: "#f4f6ff",
    secondaryBorder: "#f4f6ff",
    secondaryBgHover: "#0a1130",
    shadow: BTN_SHADOW,
    shadowHover: BTN_SHADOW_HOVER,
  },
};

export const TOKENS: Record<Mode, ModeTokens> = { light: LIGHT, dark: DARK };

/** Shared, mode-independent tokens. */
export const RADIUS_REM = 0.375; // --radius (6px)
export const FONT_HEADING =
  '"Futura PT","Futura PT Fallback",Jost,Poppins,Inter,system-ui,sans-serif';
export const FONT_BODY =
  'Poppins,"Poppins Fallback",Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
