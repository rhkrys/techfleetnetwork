import { defineConfig } from "vitepress";

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
      {
        text: "Components — Atoms",
        collapsed: false,
        items: [
          { text: "Button", link: "/components/atoms/Button" },
          { text: "Icon", link: "/components/atoms/Icon" },
          { text: "Badge", link: "/components/atoms/Badge" },
          { text: "Label", link: "/components/atoms/Label" },
          { text: "Input", link: "/components/atoms/Input" },
          { text: "Textarea", link: "/components/atoms/Textarea" },
          { text: "Checkbox", link: "/components/atoms/Checkbox" },
          { text: "Switch", link: "/components/atoms/Switch" },
          { text: "Skeleton", link: "/components/atoms/Skeleton" },
          { text: "Separator", link: "/components/atoms/Separator" },
        ],
      },
      {
        text: "Components — Molecules",
        collapsed: false,
        items: [
          { text: "Card", link: "/components/molecules/Card" },
          { text: "Field", link: "/components/molecules/Field" },
          { text: "Form field layer (RHF)", link: "/components/molecules/form/README" },
          { text: "Alert", link: "/components/molecules/Alert" },
          { text: "Tooltip", link: "/components/molecules/Tooltip" },
        ],
      },
      {
        text: "Components — Organisms",
        collapsed: false,
        items: [{ text: "Dialog", link: "/components/organisms/Dialog" }],
      },
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
