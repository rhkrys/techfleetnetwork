// Auto-registry of every live demo. Drop a `*.demo.tsx` file anywhere under
// .vitepress/demos/ and it is registered here by its filename (the part before
// `.demo.tsx`), which is the `name` the <Demo name="…" /> tag references.
//
// Using import.meta.glob(eager) so there is NO hand-maintained list to drift as
// the catalog grows — matching the "docs must match the code" guarantee.
import type { ComponentType } from "react";

const modules = import.meta.glob<{ default: ComponentType }>("./**/*.demo.tsx", {
  eager: true,
});

export const registry: Record<string, ComponentType> = {};

for (const path in modules) {
  const file = path.split("/").pop() ?? "";
  const name = file.replace(/\.demo\.tsx$/, "");
  registry[name] = modules[path].default;
}

/** Names of all registered demos (used by the docs coverage guard). */
export const demoNames = (): string[] => Object.keys(registry).sort();
