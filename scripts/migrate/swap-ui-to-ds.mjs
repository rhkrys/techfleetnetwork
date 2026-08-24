/**
 * Migration codemod: rewrite drop-in `@/components/ui/<mod>` imports to the owned
 * design system `@/design-system`. ONLY handles the API-compatible atom set below
 * (same named exports, same props) — anything else is left untouched for manual
 * migration. Merges the rewritten names into a single `@/design-system` import
 * (folding any existing one). Run typecheck afterwards to catch stragglers.
 *
 *   node scripts/migrate/swap-ui-to-ds.mjs <file> [<file> ...]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Drop-in modules whose DS exports match shadcn's names + props 1:1.
const DROP_IN = new Set([
  "button",
  "badge",
  "card",
  "label",
  "input",
  "textarea",
  "separator",
  "skeleton",
  "tabs",
  "avatar",
  "progress",
  "aspect-ratio",
  "scroll-area",
  "accordion",
  "breadcrumb",
  "collapsible",
  "alert",
]);

// `[^{}]*` (not `[\s\S]*?`) so a match can never span across two imports — the
// specifier list between the braces cannot itself contain a brace.
const IMPORT_RE =
  /import\s+(type\s+)?\{([^{}]*)\}\s+from\s+["']@\/(components\/ui\/([a-z-]+)|design-system)["'];?[ \t]*\n?/g;

function migrate(file) {
  if (!existsSync(file)) return { file, status: "missing" };
  const src = readFileSync(file, "utf8");
  const collected = new Set();
  let touchedUi = false;
  let firstIdx = -1;

  // Pass 1: find matching imports, collect names, remember removal spots.
  const removals = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const isType = Boolean(m[1]);
    const target = m[3]; // "components/ui/<mod>" or "design-system"
    const mod = m[4]; // <mod> or undefined
    const isDs = target === "design-system";
    const isDropInUi = mod && DROP_IN.has(mod);
    if (!isDs && !isDropInUi) continue; // leave non-drop-in ui imports alone
    if (isType) continue; // don't fold `import type {…}` — keep it explicit
    if (isDropInUi) touchedUi = true;
    m[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((name) => collected.add(name));
    removals.push([m.index, m.index + m[0].length]);
    if (firstIdx === -1) firstIdx = m.index;
  }

  if (!touchedUi) return { file, status: "skip" }; // nothing from ui/* to migrate

  // Pass 2: build new source — remove matched lines, insert one merged import.
  let out = "";
  let cursor = 0;
  const merged = `import { ${[...collected].sort().join(", ")} } from "@/design-system";\n`;
  for (const [start, end] of removals) {
    out += src.slice(cursor, start);
    if (start === firstIdx) out += merged; // drop the merged import where the first removed one was
    cursor = end;
  }
  out += src.slice(cursor);
  out = out.replace(/\n{3,}/g, "\n\n"); // collapse blank runs left by removed imports
  writeFileSync(file, out);
  return { file, status: "migrated", names: [...collected].sort() };
}

const files = process.argv.slice(2);
if (!files.length) {
  // eslint-disable-next-line no-console
  console.error("usage: node scripts/migrate/swap-ui-to-ds.mjs <file> [<file> ...]");
  process.exit(1);
}
let migrated = 0;
for (const f of files) {
  const r = migrate(f);
  if (r.status === "migrated") migrated++;
  // eslint-disable-next-line no-console
  console.log(`${r.status.padEnd(9)} ${f}${r.names ? "  → " + r.names.join(", ") : ""}`);
}
// eslint-disable-next-line no-console
console.log(`\n${migrated}/${files.length} files migrated.`);
