import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import { createAppTheme } from "@/design-system";
// The docs live-demo registry auto-collects every .vitepress/demos/**/*.demo.tsx.
// Rendering each one here proves the demos actually mount (docs:build can't — the
// demos are client-only islands, skipped during SSR), catching bad props/imports.
import { registry } from "../../../../docs/design/design-system/.vitepress/demos/registry";

const theme = createAppTheme("light");

function renderDemo(name: string) {
  const Comp = registry[name];
  return render(
    createElement(
      StyledEngineProvider,
      { injectFirst: true },
      createElement(ThemeProvider, { theme }, createElement(Comp))
    )
  );
}

describe("docs live demos", () => {
  const names = Object.keys(registry).sort();

  it("registers a healthy number of demos", () => {
    expect(names.length).toBeGreaterThan(70);
  });

  it.each(names)("demo %s mounts without throwing", (name) => {
    expect(() => renderDemo(name)).not.toThrow();
    cleanup();
  });
});
