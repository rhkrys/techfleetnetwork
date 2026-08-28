#!/usr/bin/env node
// CI guard (BLOCKING): every real email template must have a TIER.
//
// The tier registry (supabase/functions/_shared/email/domain/email-tiers.ts) is
// the single source of truth for how an email may be gated and unsubscribed from.
// If a template can be sent but has no tier entry, a send path could silently
// treat a critical email as gate-able, or a marketing email as un-gated. This
// guard fails the build if any template in TEMPLATES (registry.ts), AUTH_TEMPLATES
// or BULK_TEMPLATES (types.ts) is missing from EMAIL_TIERS.
//
// Requirements: docs/design/email-rearchitecture-requirements.md §6, §9.
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const F_TIERS = join(ROOT, "supabase/functions/_shared/email/domain/email-tiers.ts");
const F_REGISTRY = join(
  ROOT,
  "supabase/functions/_shared/transactional-email-templates/registry.ts"
);
const F_TYPES = join(ROOT, "supabase/functions/_shared/email/domain/types.ts");

const read = (p) => readFileSync(p, "utf8");

// Keys of EMAIL_TIERS: entries are `<key>: {` (bare or quoted). Slice from the
// registry declaration so the EmailTypeSpec interface above it can't match.
function registeredTemplates(src) {
  const start = src.indexOf("EMAIL_TIERS");
  const body = start >= 0 ? src.slice(start) : src;
  const keys = new Set();
  const re = /(?:^|\n)\s*(['"]?)([A-Za-z0-9_-]+)\1\s*:\s*\{/g;
  let m;
  while ((m = re.exec(body))) keys.add(m[2]);
  return keys;
}

// Keys of the TEMPLATES record (all quoted): `'name': component,`
function registryTemplates(src) {
  const start = src.indexOf("TEMPLATES");
  const body = start >= 0 ? src.slice(start) : src;
  const keys = new Set();
  const re = /(?:^|\n)\s*['"]([A-Za-z0-9_-]+)['"]\s*:/g;
  let m;
  while ((m = re.exec(body))) keys.add(m[1]);
  return keys;
}

// Quoted strings inside a `NAME = new Set<...>([ ... ])` literal.
function setMembers(src, name) {
  const idx = src.indexOf(name);
  if (idx < 0) return new Set();
  const open = src.indexOf("[", idx);
  const close = src.indexOf("]", open);
  if (open < 0 || close < 0) return new Set();
  const block = src.slice(open, close);
  const keys = new Set();
  const re = /['"]([A-Za-z0-9_-]+)['"]/g;
  let m;
  while ((m = re.exec(block))) keys.add(m[1]);
  return keys;
}

const required = new Set();
if (existsSync(F_REGISTRY)) for (const k of registryTemplates(read(F_REGISTRY))) required.add(k);
if (existsSync(F_TYPES)) {
  const typesSrc = read(F_TYPES);
  for (const k of setMembers(typesSrc, "AUTH_TEMPLATES")) required.add(k);
  for (const k of setMembers(typesSrc, "BULK_TEMPLATES")) required.add(k);
}

// Fail closed: an empty required set means the registry/types source files
// moved or were renamed — a broken scan, NOT "no templates to check".
if (required.size === 0) {
  console.error(
    `check-email-tier-registry: scanned 0 templates under ` +
      `${relative(ROOT, F_REGISTRY)} + ${relative(ROOT, F_TYPES)} — path moved?`
  );
  process.exit(1);
}

// The tier registry itself must exist. If templates require a tier but the
// registry file is gone, fail closed instead of silently passing.
if (!existsSync(F_TIERS)) {
  console.error(
    `check-email-tier-registry: tier registry missing at ${relative(ROOT, F_TIERS)} ` +
      `but ${required.size} templates require a tier — path moved?`
  );
  process.exit(1);
}

const registered = registeredTemplates(read(F_TIERS));

const missing = [...required].filter((t) => !registered.has(t)).sort();

if (missing.length) {
  console.error(
    "Email templates missing a tier registry entry:\n" +
      missing.map((t) => `  • ${t}`).join("\n") +
      "\n\nAdd each to EMAIL_TIERS in supabase/functions/_shared/email/domain/email-tiers.ts."
  );
  process.exit(1);
}

console.log(
  `✓ check-email-tier-registry: OK — ${required.size} templates scanned, 0 missing a tier ` +
    `(${registered.size} registered in EMAIL_TIERS).`
);
