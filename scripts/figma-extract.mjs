#!/usr/bin/env node
// scripts/figma-extract.mjs
//
// Extract Tech Fleet workshop content from FigJam boards via the Figma REST API
// (Phase A of docs/fleety-workshop-ingestion-prd.md). This reads the real board
// — sticky notes, sections, text, tables, connector labels — NOT the community
// landing page. No Firecrawl, no scraping. The Figma REST API is free.
//
// Auth + config come from the environment (never hard-code or pass the token as
// an arg, so it can't leak into shell history):
//   FIGMA_TOKEN     (required)  Figma personal access token, file-read scope.
//   FIGMA_TEAM_ID   (optional)  default team to enumerate when --team is omitted.
//
// Usage:
//   # Single-board fidelity test (recommended first) — pass a FigJam URL or key:
//   FIGMA_TOKEN=xxx node scripts/figma-extract.mjs --file "https://www.figma.com/board/ABC123/My-Workshop"
//
//   # All boards in a team (auto-enumerates every project + file):
//   FIGMA_TOKEN=xxx node scripts/figma-extract.mjs --team 1234567890
//
//   # All boards in a single project:
//   FIGMA_TOKEN=xxx node scripts/figma-extract.mjs --project 987654321
//
// Options: --out <dir> (default data/workshops)  --limit <n>  --quiet
//
// Output per board: data/workshops/<slug>.raw.md  (human-reviewable)
//                   data/workshops/<slug>.raw.json (structured, for normalization)

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const API = "https://api.figma.com/v1";
const TOKEN = process.env.FIGMA_TOKEN || "";

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { out: "data/workshops", limit: Infinity, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--file") a.file = argv[++i];
    else if (k === "--team") a.team = argv[++i];
    else if (k === "--project") a.project = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--limit") a.limit = Number(argv[++i]) || Infinity;
    else if (k === "--quiet") a.quiet = true;
    else { console.error(`Unknown arg: ${k}`); process.exit(2); }
  }
  return a;
}

const args = parseArgs(process.argv);
const log = (...m) => { if (!args.quiet) console.log(...m); };

if (!TOKEN) {
  console.error("FIGMA_TOKEN is not set. Generate one at Figma → Settings → Security → Personal access tokens (file-read scope), then:\n  export FIGMA_TOKEN=... (or prefix the command)");
  process.exit(1);
}

// ── Figma API helper (rate-limit aware) ──────────────────────────────────────
async function figmaGet(pathname) {
  const url = `${API}${pathname}`;
  if (!url.startsWith(`${API}/`)) throw new Error(`Refusing non-Figma URL: ${url}`); // SSRF guard
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: { "X-Figma-Token": TOKEN } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after")) || Math.min(30, 2 ** attempt);
      log(`  ! ${res.status} on ${pathname} — retrying in ${retryAfter}s (attempt ${attempt}/5)`);
      await sleep(retryAfter * 1000);
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`Figma API ${res.status} on ${pathname}: ${body.slice(0, 300)}`);
  }
  throw new Error(`Figma API kept failing on ${pathname} after retries`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// figma.com/(board|file|design)/<KEY>/... or a bare key.
function fileKeyFromInput(input) {
  const m = String(input).match(/figma\.com\/(?:board|file|design)\/([A-Za-z0-9]+)/i);
  return m ? m[1] : String(input).trim();
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";
}

// ── node-tree extraction ─────────────────────────────────────────────────────
// Text-bearing FigJam/Figma node types.
const TEXT_TYPES = new Set(["TEXT", "STICKY", "SHAPE_WITH_TEXT"]);

function nodeText(node) {
  if (typeof node.characters === "string" && node.characters.trim()) return node.characters.trim();
  return "";
}

function posOf(node) {
  const b = node.absoluteBoundingBox;
  return b ? { x: b.x ?? 0, y: b.y ?? 0 } : { x: 0, y: 0 };
}

// Sort siblings into reading order: top-to-bottom, then left-to-right, with a
// row tolerance so a horizontal row of stickies reads left-to-right.
function readingOrder(nodes) {
  const ROW = 80; // px tolerance for "same row"
  return [...nodes].sort((a, b) => {
    const pa = posOf(a), pb = posOf(b);
    if (Math.abs(pa.y - pb.y) > ROW) return pa.y - pb.y;
    return pa.x - pb.x;
  });
}

// Walk a node's children into an ordered block tree.
function walkChildren(children) {
  const blocks = [];
  for (const node of readingOrder(children ?? [])) {
    const t = node.type;
    if (t === "SECTION") {
      blocks.push({ kind: "section", name: node.name || "(untitled section)", children: walkChildren(node.children) });
    } else if (t === "TABLE") {
      const cells = collectText(node);
      if (cells.length) blocks.push({ kind: "table", name: node.name || "table", rows: cells });
    } else if (TEXT_TYPES.has(t)) {
      const text = nodeText(node);
      if (text) blocks.push({ kind: t.toLowerCase(), text });
    } else if (t === "CONNECTOR") {
      const text = nodeText(node);
      if (text) blocks.push({ kind: "connector", text });
    } else if (node.children?.length) {
      // FRAME / GROUP / CANVAS and other containers: flatten their children inline.
      blocks.push(...walkChildren(node.children));
    } else {
      const text = nodeText(node);
      if (text) blocks.push({ kind: "text", text });
    }
  }
  return blocks;
}

// Flatten all text under a node (used for TABLE cells).
function collectText(node, acc = []) {
  const text = nodeText(node);
  if (text) acc.push(text);
  for (const c of node.children ?? []) collectText(c, acc);
  return acc;
}

function countTextBlocks(blocks) {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === "section") n += countTextBlocks(b.children);
    else if (b.text || b.rows) n += 1;
  }
  return n;
}

// ── markdown rendering ───────────────────────────────────────────────────────
function renderBlocks(blocks, depth = 2) {
  const lines = [];
  const h = "#".repeat(Math.min(depth, 6));
  for (const b of blocks) {
    if (b.kind === "section") {
      lines.push("", `${h} ${b.name}`, "");
      lines.push(renderBlocks(b.children, depth + 1));
    } else if (b.kind === "table") {
      lines.push(`- **table (${b.name})**: ${b.rows.join(" | ")}`);
    } else if (b.kind === "connector") {
      lines.push(`- _(connector)_ ${b.text}`);
    } else {
      // sticky / text / shape_with_text — one bullet per node, newlines flattened.
      lines.push(`- ${b.text.replace(/\s*\n\s*/g, " / ")}`);
    }
  }
  return lines.join("\n");
}

function renderMarkdown(meta, blocks) {
  const header = [
    `# ${meta.name}`,
    "",
    `> Source: ${meta.url}`,
    `> File key: \`${meta.key}\` · Last modified: ${meta.lastModified ?? "?"} · Extracted: ${meta.extractedAt}`,
    `> Text blocks: ${meta.textBlockCount}`,
    "",
    "<!-- Raw extract from the Figma REST API (Phase A). Reviewed/normalized in Phase B. -->",
  ].join("\n");
  return `${header}\n${renderBlocks(blocks)}\n`;
}

// ── per-file extraction ──────────────────────────────────────────────────────
async function extractFile(key, hintName, extractedAt, outDir) {
  const file = await figmaGet(`/files/${encodeURIComponent(key)}`);
  const name = file.name || hintName || key;
  const canvases = file.document?.children ?? [];
  // Most FigJam boards are a single page; support multiple by wrapping pages.
  let blocks = [];
  if (canvases.length <= 1) {
    blocks = walkChildren(canvases[0]?.children);
  } else {
    for (const canvas of canvases) {
      blocks.push({ kind: "section", name: `Page: ${canvas.name}`, children: walkChildren(canvas.children) });
    }
  }
  const textBlockCount = countTextBlocks(blocks);
  const meta = {
    key,
    name,
    url: `https://www.figma.com/board/${key}/`,
    lastModified: file.lastModified,
    extractedAt,
    textBlockCount,
  };
  const structured = { meta, blocks };
  meta.contentHash = createHash("sha256").update(JSON.stringify(blocks)).digest("hex");

  const slug = slugify(name);
  await writeFile(path.join(outDir, `${slug}.raw.json`), JSON.stringify(structured, null, 2), "utf8");
  await writeFile(path.join(outDir, `${slug}.raw.md`), renderMarkdown(meta, blocks), "utf8");
  return { name, slug, textBlockCount };
}

// ── enumerate files in a team or project ─────────────────────────────────────
async function listTeamFiles(teamId) {
  const { projects } = await figmaGet(`/teams/${encodeURIComponent(teamId)}/projects`);
  const files = [];
  for (const p of projects ?? []) {
    const res = await figmaGet(`/projects/${encodeURIComponent(p.id)}/files`);
    for (const f of res.files ?? []) files.push({ key: f.key, name: f.name, project: p.name });
    await sleep(300); // pace project listing
  }
  return files;
}

async function listProjectFiles(projectId) {
  const res = await figmaGet(`/projects/${encodeURIComponent(projectId)}/files`);
  return (res.files ?? []).map((f) => ({ key: f.key, name: f.name }));
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const outDir = path.resolve(process.cwd(), args.out);
  await mkdir(outDir, { recursive: true });
  const extractedAt = new Date().toISOString();

  let targets = [];
  if (args.file) {
    targets = [{ key: fileKeyFromInput(args.file) }];
  } else if (args.project) {
    targets = await listProjectFiles(args.project);
  } else {
    const teamId = args.team || process.env.FIGMA_TEAM_ID;
    if (!teamId) {
      console.error("Provide one of: --file <url|key>, --project <id>, --team <id> (or set FIGMA_TEAM_ID).");
      process.exit(2);
    }
    targets = await listTeamFiles(teamId);
  }

  if (!targets.length) { console.error("No files found for the given target."); process.exit(1); }
  targets = targets.slice(0, args.limit);
  log(`Extracting ${targets.length} board(s) → ${outDir}\n`);

  const results = [];
  const errors = [];
  for (const t of targets) {
    try {
      const r = await extractFile(t.key, t.name, extractedAt, outDir);
      log(`  ✓ ${r.name}  (${r.textBlockCount} text blocks) → ${r.slug}.raw.md`);
      results.push(r);
    } catch (e) {
      console.error(`  ✗ ${t.name || t.key}: ${e.message}`);
      errors.push({ key: t.key, name: t.name, error: e.message });
    }
    await sleep(400); // pace file fetches (stay well under rate limits)
  }

  log(`\nDone: ${results.length} extracted, ${errors.length} failed.`);
  const emptyish = results.filter((r) => r.textBlockCount < 3);
  if (emptyish.length) {
    log(`\n⚠ ${emptyish.length} board(s) had <3 text blocks — likely image/widget-heavy. Review these for fidelity:`);
    for (const r of emptyish) log(`   - ${r.name} (${r.slug})`);
  }
  await writeFile(
    path.join(outDir, "_extract-report.json"),
    JSON.stringify({ extractedAt, extracted: results, errors }, null, 2),
    "utf8",
  );
  if (errors.length && !results.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
