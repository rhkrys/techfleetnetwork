import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Docs ↔ code drift guard. Fails CI if the design-system documentation stops
 * matching the code, enforcing the owner requirement "the documentation must
 * match the codebase components" and "a demo on every component":
 *
 *   1. every component SOURCE file has a live demo (a Name.demo.tsx under demos/)
 *   2. every demo has a documentation page (a Name.md under components/)
 *   3. every component doc page embeds its Demo tag
 *
 * New pages are produced by `node scripts/docs/gen-component-docs.mjs`; the
 * VitePress sidebar is built from the pages on disk, so it can't drift either.
 */
const ROOT = process.cwd();
const SRC_COMPONENTS = join(ROOT, "src", "design-system", "components");
const SRC_HOOKS = join(ROOT, "src", "design-system", "hooks");
const DEMOS = join(ROOT, "docs", "design", "design-system", ".vitepress", "demos");
const DOCS = join(ROOT, "docs", "design", "design-system", "components");

// RHF form adapters are documented + demoed together on the "Form field layer"
// page via the FormAdapters demo, so they are not expected to have their own.
const SRC_EXCLUDE = new Set(["RHFTextField", "RHFTextarea", "RHFCheckbox", "RHFSwitch"]);
// Doc pages that are not a single component (overview / grouped guide).
const DOC_EXCLUDE = new Set(["index", "README"]);

function walk(dir: string, test: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, test));
    else if (test(p)) out.push(p);
  }
  return out;
}

const base = (p: string, suffix: RegExp) => p.split(/[\\/]/).pop()!.replace(suffix, "");

const sourceNames = [
  ...walk(SRC_COMPONENTS, (p) => p.endsWith(".tsx") && !p.includes("__tests__")).map((p) =>
    base(p, /\.tsx$/)
  ),
  ...walk(SRC_HOOKS, (p) => p.endsWith(".ts") && !p.endsWith(".d.ts")).map((p) => base(p, /\.ts$/)),
].filter((n) => !SRC_EXCLUDE.has(n));

const demoNames = new Set(
  walk(DEMOS, (p) => p.endsWith(".demo.tsx")).map((p) => base(p, /\.demo\.tsx$/))
);

const docPages = walk(DOCS, (p) => p.endsWith(".md"));
const docNames = new Set(docPages.map((p) => base(p, /\.md$/)));

describe("design-system docs coverage", () => {
  it("every component source has a live demo", () => {
    const missing = sourceNames.filter((n) => !demoNames.has(n)).sort();
    expect(missing, `components missing a .demo.tsx: ${missing.join(", ")}`).toEqual([]);
  });

  it("every demo has a documentation page", () => {
    // FormAdapters lives inside the RHF form page rather than its own page.
    const covered = new Set([...docNames, "FormAdapters"]);
    const missing = [...demoNames].filter((n) => !covered.has(n)).sort();
    expect(missing, `demos missing a doc page: ${missing.join(", ")}`).toEqual([]);
  });

  it("every component doc page embeds its live demo", () => {
    const missing = docPages
      .filter((p) => !DOC_EXCLUDE.has(base(p, /\.md$/)))
      .filter((p) => !/<Demo\s+name=/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(DOCS.length + 1).replace(/\\/g, "/"))
      .sort();
    expect(missing, `pages missing a <Demo/>: ${missing.join(", ")}`).toEqual([]);
  });
});
