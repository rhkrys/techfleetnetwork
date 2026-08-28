#!/usr/bin/env node
/**
 * CI guard: defense-in-depth layers may only import downward.
 *   ui → state → flows → services → domain
 *
 * Reverse edges (e.g. services importing flows, or domain importing UI)
 * collapse the architecture back into the sediment we just rebuilt out of.
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard } from "./_guard.mjs";

const RANK = { domain: 0, services: 1, flows: 2, state: 3, ui: 4, testing: 99 };

// src/features/auth/<layer>/...
function layerOf(rel) {
  return rel.split("/")[3] ?? null;
}

runScanGuard({
  name: "check-auth-layer-graph",
  roots: ["src/features/auth"],
  include: /\.(ts|tsx)$/,
  exclude: /\.test\.(ts|tsx)$/,
  rule(src, rel) {
    const fromLayer = layerOf(rel);
    if (!fromLayer || !(fromLayer in RANK)) return [];
    if (fromLayer === "testing") return [];
    const out = [];
    const importRe = /from\s+["']([^"']+)["']/g;
    let m;
    while ((m = importRe.exec(src))) {
      const spec = m[1];
      // Only check internal feature imports.
      if (!spec.startsWith("..") && !spec.startsWith("@/features/auth")) continue;
      // Normalize to a layer name if possible.
      const layers = ["domain", "services", "flows", "state", "ui"];
      const hit = layers.find((l) => spec.includes(`/${l}/`) || spec.endsWith(`/${l}`));
      if (!hit) continue;
      if (RANK[hit] > RANK[fromLayer]) {
        out.push({ text: `(${fromLayer} → ${hit})  ${spec} — imports must flow downward` });
      }
    }
    return out;
  },
});
