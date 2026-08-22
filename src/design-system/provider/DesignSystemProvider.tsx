/**
 * DesignSystemProvider — mounts the TFDS MUI theme, bridged to the app's
 * existing light/dark source of truth (@/components/ThemeProvider).
 *
 * Phase-0 coexistence notes:
 * - StyledEngineProvider injectFirst: MUI's styles inject before Tailwind's,
 *   so Tailwind utilities can still override during the migration. DS components
 *   carry no Tailwind classes, so there is no conflict for them.
 * - No global <CssBaseline/>: it would reset the whole document and fight
 *   Tailwind's preflight + index.css. The theme alone styles DS components.
 */
import { useMemo, type ReactNode } from "react";
import { StyledEngineProvider, ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { useTheme as useAppTheme } from "@/components/ThemeProvider";
import { createAppTheme } from "../theme/createAppTheme";

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useAppTheme();
  const theme = useMemo(() => createAppTheme(resolvedTheme), [resolvedTheme]);

  return (
    <StyledEngineProvider injectFirst>
      <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>
    </StyledEngineProvider>
  );
}
