/**
 * Generates a documentation page (with an embedded live <Demo>) for every DS
 * component that has a demo, and inserts a "Live demo" section into the existing
 * hand-written pages that lack one. The blurb is pulled from each component's
 * source-header comment so the docs stay honest to the code.
 *
 * The component sidebar is built dynamically in .vitepress/config.ts by scanning
 * the generated pages, so it can never drift from what exists on disk.
 *
 *   node scripts/docs/gen-component-docs.mjs           # write
 *
 * Coverage (every component source has a demo + page) is enforced by the vitest
 * guard src/design-system/components/__tests__/docs-coverage.test.ts.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DS = join(ROOT, "docs", "design", "design-system");
const DEMOS_DIR = join(DS, ".vitepress", "demos");
const DOCS_DIR = join(DS, "components");
const SRC = join(ROOT, "src", "design-system");

const LAYER_NOUN = {
  atoms: "atom",
  molecules: "molecule",
  organisms: "organism",
  primitives: "primitive",
  layout: "layout",
  hooks: "hook",
};

// Demo name -> existing custom doc page (relative to components/). These demos
// live inside a hand-written page rather than getting their own generated page.
const DOC_OVERRIDE = {
  FormAdapters: "molecules/form/README.md",
};

/** Recursively collect files matching a predicate. */
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/** All demos: { name, layer }. Layer = first folder under demos/. */
function discoverDemos() {
  return walk(DEMOS_DIR, (p) => p.endsWith(".demo.tsx")).map((p) => {
    const rel = p.slice(DEMOS_DIR.length + 1).replace(/\\/g, "/");
    const [layer, ...rest] = rel.split("/");
    const name = rest.join("/").replace(/\.demo\.tsx$/, "");
    return { name, layer };
  });
}

/** Find a component source file by basename and return {blurb, srcRel}. */
function sourceInfo(name) {
  const matches = walk(
    SRC,
    (p) => (p.endsWith(".tsx") || p.endsWith(".ts")) && !p.includes("__tests__")
  ).filter((p) => {
    const base = p.split(/[\\/]/).pop();
    return base === `${name}.tsx` || base === `${name}.ts`;
  });
  if (!matches.length) return { blurb: "", srcRel: null };
  const file = matches[0];
  const srcRel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  // First meaningful line of the leading /** ... */ header.
  const m = text.match(/\/\*\*\s*\n\s*\*\s*(.+)/);
  let blurb = m ? m[1].trim() : "";
  // Normalize "Name (layer) — description" to just the description sentence.
  blurb = blurb.replace(/^[A-Za-z0-9]+(\s*\+\s*[A-Za-z0-9]+)*\s*(\([^)]*\))?\s*[—-]\s*/, "");
  blurb = blurb.replace(/\s*See .*$/, "").trim();
  if (blurb && !/[.!?]$/.test(blurb)) blurb += ".";
  // VitePress parses markdown as Vue, so raw <tags> in prose (e.g. "<select>")
  // read as unclosed elements and break the build. Escape angle brackets.
  blurb = blurb.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { blurb, srcRel };
}

function generatedPage(name, layer, blurb, srcRel) {
  const noun = LAYER_NOUN[layer] ?? layer;
  const lines = [];
  lines.push(`# ${name} (${noun})`);
  lines.push("");
  lines.push(blurb || `The \`${name}\` ${noun}, part of the Tech Fleet Design System.`);
  lines.push("");
  lines.push(`- **Layer:** ${noun} · **Import:** \`import { ${name} } from "@/design-system"\``);
  lines.push("");
  lines.push("## Live demo");
  lines.push("");
  lines.push(`<Demo name="${name}" />`);
  lines.push("");
  lines.push("## Reference");
  lines.push("");
  if (srcRel) {
    lines.push(
      `Built on MUI Core and themed to the Tech Fleet brand. See the source for the full prop types: [\`${srcRel}\`](https://github.com/techfleetworks/techfleetnetwork/blob/main/${srcRel}).`
    );
  } else {
    lines.push("Built on MUI Core and themed to the Tech Fleet brand.");
  }
  lines.push("");
  return lines.join("\n");
}

function insertDemoSection(src, name) {
  const tag = `<Demo name="${name}" />`;
  if (src.includes(tag)) return { src, changed: false };
  const block = `\n## Live demo\n\n${tag}\n`;
  const idx = src.indexOf("\n## ");
  const next =
    idx !== -1 ? src.slice(0, idx) + block + src.slice(idx) : src.trimEnd() + "\n" + block;
  return { src: next, changed: true };
}

const demos = discoverDemos();
let created = 0;
let edited = 0;

for (const { name, layer } of demos) {
  const overridden = DOC_OVERRIDE[name];
  if (overridden) {
    const docPath = join(DOCS_DIR, overridden);
    if (existsSync(docPath)) {
      const { src, changed } = insertDemoSection(readFileSync(docPath, "utf8"), name);
      if (changed) {
        writeFileSync(docPath, src);
        edited++;
      }
    }
    continue;
  }
  const docPath = join(DOCS_DIR, layer, `${name}.md`);
  if (existsSync(docPath)) {
    const { src, changed } = insertDemoSection(readFileSync(docPath, "utf8"), name);
    if (changed) {
      writeFileSync(docPath, src);
      edited++;
    }
  } else {
    const { blurb, srcRel } = sourceInfo(name);
    mkdirSync(dirname(docPath), { recursive: true });
    writeFileSync(docPath, generatedPage(name, layer, blurb, srcRel));
    created++;
  }
}

// eslint-disable-next-line no-console
console.log(
  `gen-component-docs: ${demos.length} demos · ${created} pages created · ${edited} pages updated`
);
