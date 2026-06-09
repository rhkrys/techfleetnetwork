#!/usr/bin/env node
/**
 * CI guard: defense-in-depth layers may only import downward.
 *   ui → state → flows → services → domain
 *
 * Reverse edges (e.g. services importing flows, or domain importing UI)
 * collapse the architecture back into the sediment we just rebuilt out of.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASE = "src/features/auth";

const RANK = { domain: 0, services: 1, flows: 2, state: 3, ui: 4, testing: 99 };

function layerOf(rel) {
  const parts = rel.split("/");
  // src/features/auth/<layer>/...
  return parts[3] ?? null;
}

const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    const fromLayer = layerOf(rel);
    if (!fromLayer || !(fromLayer in RANK)) continue;
    if (fromLayer === "testing") continue;
    const body = readFileSync(full, "utf8");
    const importRe = /from\s+["']([^"']+)["']/g;
    let m;
    while ((m = importRe.exec(body))) {
      const spec = m[1];
      // Only check internal feature imports.
      if (!spec.startsWith("..") && !spec.startsWith("@/features/auth")) continue;
      // Normalize to a layer name if possible.
      const layers = ["domain", "services", "flows", "state", "ui"];
      const hit = layers.find((l) => spec.includes(`/${l}/`) || spec.endsWith(`/${l}`));
      if (!hit) continue;
      if (RANK[hit] > RANK[fromLayer]) {
        offenders.push({ rel, fromLayer, importedLayer: hit, spec });
      }
    }
  }
}

walk(join(ROOT, BASE));

if (offenders.length > 0) {
  console.error("✗ auth layer graph violation — imports must flow downward (ui → state → flows → services → domain)");
  for (const o of offenders) console.error(`  ${o.rel}  (${o.fromLayer} → ${o.importedLayer})  ${o.spec}`);
  process.exit(1);
}
console.log("✓ auth layer graph: all imports flow downward");
