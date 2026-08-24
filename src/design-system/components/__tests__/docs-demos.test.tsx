import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { ThemeContext } from "@/components/ThemeProvider";
import { DesignSystemProvider } from "@/design-system";
// The docs live-demo registry auto-collects every .vitepress/demos/**/*.demo.tsx.
// Rendering each one here proves the demos actually mount (docs:build can't — the
// demos are client-only islands, skipped during SSR), catching bad props/imports.
// Mounts through the exact provider stack the docs use (ThemeContext +
// DesignSystemProvider) so this mirrors the real island mount path in mount.tsx.
import { registry } from "../../../../docs/design/design-system/.vitepress/demos/registry";

function renderDemo(name: string) {
  const Comp = registry[name];
  return render(
    createElement(
      ThemeContext.Provider,
      { value: { theme: "light", resolvedTheme: "light", setTheme: () => {} } },
      createElement(DesignSystemProvider, null, createElement(Comp))
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
