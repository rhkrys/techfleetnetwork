/**
 * createAppTheme(mode) — assembles the TFDS MUI theme for a color mode.
 * Rebuilt by DesignSystemProvider whenever the app's resolvedTheme flips,
 * so palette values are always the concrete light/dark brand colors (see
 * tokens.ts for why concrete values, not CSS var() references, are required).
 */
import { createTheme, type Theme } from "@mui/material/styles";
import { TOKENS, type Mode } from "./tokens";
import { typography } from "./typography";
import { components } from "./components";

export function createAppTheme(mode: Mode): Theme {
  const t = TOKENS[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: t.primary.main, dark: t.primary.dark, contrastText: t.primary.contrastText },
      secondary: { main: t.secondary.main, contrastText: t.secondary.contrastText },
      error: { main: t.error.main, contrastText: t.error.contrastText },
      success: { main: t.success.main, contrastText: t.success.contrastText },
      warning: { main: t.warning.main, contrastText: t.warning.contrastText },
      info: { main: t.primary.main, contrastText: t.primary.contrastText },
      background: { default: t.background, paper: t.paper },
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      divider: t.divider,
    },
    shape: { borderRadius: 6 },
    typography,
    components: components(mode, t),
  });
}
