import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distDir = "dist";
const assetsDir = join(distDir, "assets");

const required = [
  "https://pzvqxdgoztbfikfuifix.supabase.co",
  "sb_publishable_yKbfQNAnhEEW-9TPII5_Og_8G7gOzm2",
];
const forbidden = ["VITE_SUPABASE_URL}/functions", "undefined/functions/v1"];

function fail(message) {
  console.error(`Post-build smoke failed: ${message}`);
  process.exit(1);
}

if (!existsSync(join(distDir, "index.html"))) fail("dist/index.html was not emitted");
if (!existsSync(assetsDir)) fail("dist/assets was not emitted");

const html = readFileSync(join(distDir, "index.html"), "utf8");
if (!html.includes('<div id="root"></div>')) fail("root mount node is missing");
if (!/assets\/index-[^"']+\.js/.test(html)) fail("entry JavaScript bundle is missing");

const jsBundle = readdirSync(assetsDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => readFileSync(join(assetsDir, file), "utf8"))
  .join("\n");

// A local/e2e build legitimately bakes the LOCAL Supabase URL, not the prod one,
// so the prod-config assertion below must NOT run for it (it would false-fail the
// e2e webServer build). Detect a local build from the bundle itself (no env
// needed) and skip ONLY the prod-config check — every structural / forbidden /
// preload check still runs. Prod + preview builds still assert prod config.
const isLocalBuild = /127\.0\.0\.1:54321|localhost:54321/.test(jsBundle);
if (isLocalBuild) {
  console.log("Post-build smoke: local/e2e build detected — skipping prod-config assertion.");
} else {
  for (const value of required) {
    if (!jsBundle.includes(value))
      fail(`required production config is missing: ${value.slice(0, 24)}…`);
  }
}

for (const value of forbidden) {
  if (jsBundle.includes(value)) fail(`bundle contains a known blank-screen risk: ${value}`);
}

// Preload hygiene — each `<link rel="preload">` in the built index.html
// MUST declare `as` (browsers throw a console warning otherwise and skip
// the preload entirely) and MUST point at an asset that actually exists in
// the build output. Stale preloads were the source of the 22 "preload not
// used" warnings on 2026-06-22.
const preloadRegex = /<link\b[^>]*\brel=["']preload["'][^>]*>/gi;
const preloadTags = html.match(preloadRegex) ?? [];
for (const tag of preloadTags) {
  if (!/\bas=["'][^"']+["']/i.test(tag)) {
    fail(`<link rel="preload"> missing required \`as\` attribute: ${tag}`);
  }
  const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
  const href = hrefMatch?.[1];
  if (!href) {
    fail(`<link rel="preload"> missing \`href\`: ${tag}`);
  }
  // Skip absolute URLs (CDN-hosted assets) — only local /-rooted hrefs
  // map to a file we can stat in dist/.
  if (href.startsWith("/") && !href.startsWith("//")) {
    const localPath = join(distDir, href.replace(/^\//, "").split(/[?#]/)[0]);
    if (!existsSync(localPath)) {
      fail(`<link rel="preload"> points at a non-emitted asset: ${href}`);
    }
  }
}

console.log(
  `Post-build smoke passed: production config, app entry, and ${preloadTags.length} preload tag(s) verified.`
);
