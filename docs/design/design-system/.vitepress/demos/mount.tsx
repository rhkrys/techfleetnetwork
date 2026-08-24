// React island mount point for the docs live demos.
//
// Each demo is a `*.demo.tsx` React component (auto-registered by filename in
// ./registry). We mount it through the app's REAL provider stack —
// ThemeContext + DesignSystemProvider — so components that read the app theme
// (e.g. the AG Grid DataTable) work exactly as they do in the app. We supply a
// CONTROLLED ThemeContext value (bridged to the docs light/dark toggle) instead
// of the full <ThemeProvider>, so there are no localStorage / document-class
// side effects to fight VitePress's own theming.
import { createElement, StrictMode, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeContext } from "@/components/ThemeProvider";
import { DesignSystemProvider } from "@/design-system";
import { registry } from "./registry";

function tree(name: string, dark: boolean) {
  const Comp = registry[name] as ComponentType | undefined;
  const mode = dark ? "dark" : "light";
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
      ThemeContext.Provider,
      { value: { theme: mode, resolvedTheme: mode, setTheme: () => {} } },
      createElement(DesignSystemProvider, null, body)
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
