import { defineConfig } from "vitepress";
import { fileURLToPath, URL } from "node:url";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// The component sidebar is built by scanning the components/<layer>/*.md pages on
// disk, so it ALWAYS matches what exists — it can never silently drift from the
// code (a page is generated for every component via scripts/docs/gen-component-docs.mjs,
// and the vitest docs-coverage guard fails CI if a component lacks a page/demo).
const COMPONENTS_DIR = fileURLToPath(new URL("../components", import.meta.url));
const LAYERS: { dir: string; label: string }[] = [
  { dir: "atoms", label: "Components — Atoms" },
  { dir: "molecules", label: "Components — Molecules" },
  { dir: "organisms", label: "Components — Organisms" },
  { dir: "primitives", label: "Components — Primitives" },
  { dir: "layout", label: "Components — Layout" },
  { dir: "hooks", label: "Components — Hooks" },
];

function componentGroups() {
  return LAYERS.filter(({ dir }) => existsSync(join(COMPONENTS_DIR, dir))).map(({ dir, label }) => {
    const items = readdirSync(join(COMPONENTS_DIR, dir))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort()
      .map((name) => ({ text: name, link: `/components/${dir}/${name}` }));
    if (dir === "molecules" && existsSync(join(COMPONENTS_DIR, "molecules/form/README.md"))) {
      items.push({ text: "Form field layer (RHF)", link: "/components/molecules/form/README" });
    }
    return { text: label, collapsed: dir !== "atoms", items };
  });
}

// TechFleet Design System documentation site (VitePress).
// srcDir is this folder, so it serves the DS spec + per-component docs we already
// write alongside the code. Built to .vitepress/dist and deployed to GitHub Pages.
export default defineConfig({
  title: "Tech Fleet Design System",
  description:
    "The Tech Fleet Design System (TFDS) — an owned component library on MUI Core: atoms, molecules, and organisms, themed to the Tech Fleet brand, responsive on a 4px grid, and accessible to WCAG 2.2 AA.",
  lang: "en-US",
  // GitHub Pages for this repo serves at https://techfleetworks.github.io/techfleetnetwork/,
  // so the site base is the repo name. (The frontend app deploys separately via Cloudflare;
  // GitHub Pages is used only for these docs.)
  base: "/techfleetnetwork/",
  // Our source docs link to sibling repo files (ADRs, src/**) outside this srcDir;
  // don't fail the build on those cross-repo links.
  ignoreDeadLinks: true,
  cleanUrls: true,
  // Live component demos are React islands (see .vitepress/theme/Demo.vue): the
  // real DS components mounted client-side. VitePress runs on Vite, so we teach
  // its Vite pipeline to (a) resolve the app's `@` alias so demos can
  // `import { Button } from "@/design-system"`, and (b) transpile the demo .tsx
  // with the React automatic JSX runtime via esbuild (no @vitejs/plugin-react
  // needed — the demos never SSR; they mount only in the browser).
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../../../src", import.meta.url)),
      },
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
    },
  },
  themeConfig: {
    nav: [
      { text: "Getting started", link: "/" },
      { text: "Foundations", link: "/architecture-spec" },
      { text: "Components", link: "/components/" },
    ],
    sidebar: [
      {
        text: "Overview",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Build log & vocabulary", link: "/README" },
          { text: "Component audit", link: "/component-audit" },
        ],
      },
      {
        text: "Foundations",
        items: [
          { text: "Architecture", link: "/architecture-spec" },
          { text: "Typography system", link: "/typography-system" },
          { text: "Responsive & accessibility", link: "/responsive-and-accessibility" },
          { text: "Engineering requirements", link: "/engineering-requirements" },
        ],
      },
      ...componentGroups(),
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/techfleetworks/techfleetnetwork" }],
    footer: {
      message: "Built on MUI Core (MIT). Part of the Tech Fleet Network monorepo.",
      copyright: "Tech Fleet",
    },
  },
});
