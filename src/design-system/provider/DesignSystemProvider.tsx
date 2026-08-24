/**
 * DesignSystemProvider — mounts the TFDS MUI theme, bridged to the app's
 * existing light/dark source of truth (@/components/ThemeProvider).
 *
 * Coexistence notes:
 * - StyledEngineProvider injectFirst: MUI's styles inject before Tailwind's,
 *   so Tailwind utilities can still override during the migration. DS components
 *   carry no Tailwind classes, so there is no conflict for them.
 * - No global <CssBaseline/>: it would reset the whole document and fight
 *   Tailwind's preflight + index.css. The theme alone styles DS components.
 * - GlobalStyles: a minimal, universally-safe reduced-motion rule (only active
 *   when the user has requested it) — WCAG 2.3.3 / prefers-reduced-motion. It does
 *   not change anything for users who haven't asked to reduce motion.
 */
import { useMemo, type ReactNode } from "react";
import { StyledEngineProvider, ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import GlobalStyles from "@mui/material/GlobalStyles";
import { useTheme as useAppTheme } from "@/components/ThemeProvider";
import { createAppTheme } from "../theme/createAppTheme";

// Honor prefers-reduced-motion for users who set it (vestibular safety). Standard,
// widely-used snippet: near-instant animations/transitions instead of removing them
// (so transitionend/animationend handlers still fire).
const reducedMotion = {
  "@media (prefers-reduced-motion: reduce)": {
    "*, *::before, *::after": {
      animationDuration: "0.01ms !important",
      animationIterationCount: "1 !important",
      transitionDuration: "0.01ms !important",
      scrollBehavior: "auto !important",
    },
  },
} as const;

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useAppTheme();
  const theme = useMemo(() => createAppTheme(resolvedTheme), [resolvedTheme]);

  return (
    <StyledEngineProvider injectFirst>
      <MuiThemeProvider theme={theme}>
        <GlobalStyles styles={reducedMotion} />
        {children}
      </MuiThemeProvider>
    </StyledEngineProvider>
  );
}
