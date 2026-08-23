// React island mount point for the docs live demos.
//
// Each demo is a `*.demo.tsx` React component (auto-registered by filename in
// ./registry). We mount it inside the same MUI theme the app uses — built from
// `createAppTheme(mode)` — bridged to the docs site's light/dark toggle. We do
// NOT reuse DesignSystemProvider because it reads the app's ThemeProvider
// context, which does not exist in the docs site; the MUI providers below are
// the exact, self-contained equivalent.
import { createElement, StrictMode, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import GlobalStyles from "@mui/material/GlobalStyles";
import { createAppTheme } from "@/design-system/theme/createAppTheme";
import { registry } from "./registry";

const reducedMotion = {
  "@media (prefers-reduced-motion: reduce)": {
    "*, *::before, *::after": {
      animationDuration: "0.01ms !important",
      animationIterationCount: "1 !important",
      transitionDuration: "0.01ms !important",
    },
  },
} as const;

function tree(name: string, dark: boolean) {
  const Comp = registry[name] as ComponentType | undefined;
  const theme = createAppTheme(dark ? "dark" : "light");
  const body = Comp
    ? createElement(Comp)
    : createElement(
        "div",
        { style: { color: "crimson", fontSize: 13 } },
        `Missing demo: "${name}" (add .vitepress/demos/**/${name}.demo.tsx)`
      );
  return createElement(
    StrictMode,
    null,
    createElement(
      StyledEngineProvider,
      { injectFirst: true },
      createElement(
        ThemeProvider,
        { theme },
        createElement(GlobalStyles, { styles: reducedMotion }),
        body
      )
    )
  );
}

export function mountDemo(el: HTMLElement, name: string, dark: boolean): Root {
  const root = createRoot(el);
  root.render(tree(name, dark));
  return root;
}

export function updateDemo(root: Root, name: string, dark: boolean): void {
  root.render(tree(name, dark));
}
