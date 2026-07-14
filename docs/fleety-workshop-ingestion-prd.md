# Fleety Workshop Ingestion — PRD (v0.2 draft)

**Status:** DRAFT for Morgan's review (authored in-prompt with Claude Code)
**Sequencing:** Ships **after** the Fleety AI Rearchitecture (Fleety-PRD-v1.3) is built **and QA'd**. This is the "Figma workshop content ingestion" that §4.3 of that PRD deferred. It rides on the rearchitecture foundation (unified Gemini `text-embedding-004`, `knowledge_base` retrieval, structural citations) and must not reintroduce Firecrawl or the Lovable gateway.

---

## 1. Background — why the current approach fails

The existing `scrape-figma-workshops` edge function (Lovable-era) scrapes the Figma **Community landing page** (`figma.com/community/file/…`) with **Firecrawl**, capturing only each workshop's title and one-paragraph description. FigJam boards render on a canvas, so the actual content — sections, sticky notes, step prompts, templates — is never in the scraped HTML.

Result: for 40+ workshops, Fleety's knowledge is 40 marketing blurbs. It cannot coach specifics because the specifics were never ingested. Firecrawl is also being removed by the rearchitecture (D-04), so this function is doomed regardless.

## 2. The insight

FigJam boards are machine-readable via the **Figma REST API** (`GET /v1/files/:key`), which returns the full node tree — `SECTION`, `TEXT`, `STICKY` (`characters`), `SHAPE_WITH_TEXT`, `TABLE`, `CONNECTOR` labels — with position and grouping. The REST API works on FigJam files directly (no need to copy them into a design file) and is **free**. The files live in a Figma **team the program director owns**, so the API can enumerate and fully read them.

## 3. Goals

- **G-1** Fleety can coach the concrete steps of each workshop and the deliverable it produces, grounded in the real board content — with a citation back to the FigJam board.
- **G-2** Coaching reflects the program director's standards, not just the board's literal stickies.
- **G-3** Minimal ongoing human effort: enumerate and extract automatically; the director's effort is *approving guides*, not extracting content.
- **G-4** No new platform UI. Approval happens in-prompt with Claude Code; incorporation is a bulk data load.
- **G-5** Reuses the unified pipeline (Gemini embeddings + `knowledge_base` + structural citations). No Firecrawl, no Lovable gateway.
- **G-6 — Closed-domain sourcing (authoritative).** The data Fleety uses to determine answers is **only** Tech Fleet's own materials: the **Skills & Practices Framework**, the **user guide / Project Success Handbook**, the **Figma workshop content**, and any other **Tech Fleet materials**. Fleety does **not** use the open web to form answers. The **only** exception: when Tech Fleet's data repository has **no** data for the question, Fleety may fall back — and even then it must first say, honestly, that Tech Fleet doesn't have specific guidance, and clearly mark anything external as *not* official Tech Fleet material.

> **⚠ Design tension to resolve before building G-6 (open decision D-3 below).**
> The rearchitecture we just built **removed web search entirely** (G-06/P-03/D-04 of Fleety-PRD-v1.3) because injected web content was *overriding* the authoritative framework — the original bug. G-6 here reintroduces a *narrow, gated* web fallback for true gaps. Two ways to honor "only answer from Tech Fleet data, and be honest when you don't have it":
> - **Option A (recommended, = current build): honest gap, no web.** If Tech Fleet has no data, Fleety says so and points to the guide / Discord / office hours. Simplest, zero vendor dependency, and it *cannot* regress into P-03.
> - **Option B: controlled web fallback.** Only when Tech Fleet retrieval returns zero results above threshold; the web answer is fetched separately, **clearly labeled "not official Tech Fleet guidance,"** never blended with or ranked above Tech Fleet content, and the turn is logged as a gap so you can close it with real content. This reintroduces an external dependency and must be built carefully to avoid P-03.
> Morgan to choose A or B. Everything else in this PRD is independent of that choice.

## 4. Non-goals (explicit)

- ❌ **No in-platform review UI / approval queue / admin tab.** (The Lovable version built this; it was overkill.)
- ❌ No per-user memory, no synonym work — that's the main rearchitecture.
- ❌ No live/real-time board sync in v1 (a manual/cron re-extract is enough).
- ❌ Rendering board *visuals* to images + vision description — deferred to a later phase (text extraction covers the bulk of coaching content).

## 5. Workflow — three phases, human-in-the-loop *in prompt*

**Phase A — Extract (automated; runs where the token + network are).**
`scripts/figma-extract.mjs` reads `FIGMA_TOKEN` + a team/project/file target, enumerates the team's projects/files, pulls each board's node tree, and writes a raw, readable extract per board to `data/workshops/<slug>.raw.md` (+ `.json`). Morgan runs this once locally (or we run it in CI with the token as a secret). *Claude Code cannot call the Figma API from its sandbox, so extraction runs on Morgan's machine or CI.* Full technical spec + the script itself are in §8 and Appendix A.

**Phase B — Normalize + approve (in-prompt, with Claude).**
Claude reads each raw extract and produces a structured **coaching guide**: objective · when to use it · step-by-step · **the deliverable it produces** · coaching tips · common pitfalls — tagged with discipline + the canonical Skills & Practices deliverable/skill. Morgan reviews and refines them *in this conversation* ("tighten this," "that's not how I coach X"). The first few calibrate the normalization voice; the rest follow. Approved guides are saved to `data/workshops/<slug>.guide.md`.

**Phase C — Bulk incorporate (one data load, no UI).**
Approved guides are bulk-upserted into `knowledge_base` (`source_type = 'workshop'`, `url = <figma board>`), then embedded via the `fleety-embed` backfill (`text-embedding-004`). From there Fleety retrieves them through the existing `fleety_kb_semantic_search` with structural citations — **zero chat-side changes**.

## 6. Coaching depth (the part scraping can't give)

Board content alone yields "here are the steps." Director-level coaching also needs **what good looks like**. Where Morgan can supply them, we ingest as first-class material:
- an **evaluation rubric** per discipline ("a strong research plan has X, Y, Z"), and
- **exemplar finished deliverables** as few-shot examples (`fleety_examples`).

Optional for v1 but the biggest lever for G-2; layer in incrementally.

## 7. Member use-case scenarios (review these — this is what members get after we build it)

Each scenario is a real Tech Fleet member interaction Fleety should support once workshops + handbook are ingested. All answers cite their Tech Fleet source (workshop board and/or handbook page) and obey G-6 (Tech Fleet data only).

- **MW-01 · UX Research.** *"How do I plan and run stakeholder interviews for my project?"* → Fleety walks the Discovery/interview workshop steps, names the deliverable (interview guide + synthesis), and cites the FigJam board + the handbook Discovery Milestone page.
- **MW-02 · UX Design.** *"What should my Experience Design milestone deliverables look like?"* → Fleety pulls the handbook Experience Design Milestone + the design workshop, lists the expected deliverables, and (if a rubric is ingested) the quality bar.
- **MW-03 · Product Strategy.** *"How do I define the product vision with my team?"* → Fleety coaches through the Vision workshop steps and the handbook Vision Milestone, ending with the vision deliverable.
- **MW-04 · Project Management.** *"What's due at the Requirements milestone and how do I run it?"* → Fleety lists the Requirements milestone deliverables/activities/duties (handbook) and the workshop that produces them.
- **MW-05 · Agile Ops.** *"How do we run our sprint ceremonies on a Tech Fleet project?"* → Fleety answers from the Agile Handbook + agile-ops workshop, in Tech Fleet's cadence — not generic Scrum from the web.
- **MW-06 · New member onboarding.** *"I just joined my first project — where do I start?"* → Fleety gives the first concrete steps from Start Here + the Intake Milestone + onboarding workshop.
- **MW-07 · Deliverable-specific.** *"How do I create a service blueprint?"* → Fleety finds the workshop/method that produces it and coaches the steps; if Tech Fleet genuinely lacks it, see MW-09.
- **MW-08 · Closed-domain guardrail.** *"What's the best JavaScript framework in 2026?"* → Off-topic / not Tech Fleet material. Fleety declines to answer from the open web and redirects to Tech Fleet resources (demonstrates G-6).
- **MW-09 · Genuine gap.** *"How do I handle [a niche topic Tech Fleet hasn't documented]?"* → Tech Fleet repository returns nothing above threshold. Fleety **says so honestly**, then follows the G-6 decision: **Option A** → suggests guide/Discord/office hours; **Option B** → offers a clearly-labeled "not official Tech Fleet guidance" external answer. Either way the turn is logged as a gap for Morgan to close with real content.
- **MW-10 · Cross-source synthesis.** *"How do I complete the Vision milestone deliverable?"* → Fleety combines the **handbook definition** of the milestone with the **workshop steps** that produce it, citing both — the two halves of how the program director coaches.

## 8. Technical requirements — the extractor (`scripts/figma-extract.mjs`)

- **Runtime:** Node 18+ (uses built-in global `fetch`). Verified on Node 24. Zero npm dependencies.
- **Config (environment only — never args, so the token can't leak into shell history):**
  - `FIGMA_TOKEN` *(required)* — Figma personal access token, file-read scope.
  - `FIGMA_TEAM_ID` *(optional)* — default team to enumerate when `--team` is omitted.
- **Targets (pick one):** `--file <url|key>` (single board — the fidelity test), `--project <id>` (one project), `--team <id>` (all projects + files in a team). Options: `--out <dir>` (default `data/workshops`), `--limit <n>`, `--quiet`.
- **Figma endpoints used:** `GET /v1/teams/:id/projects`, `GET /v1/projects/:id/files`, `GET /v1/files/:key`. Auth via `X-Figma-Token` header.
- **Node types extracted:** `STICKY`, `TEXT`, `SHAPE_WITH_TEXT` (→ `characters`); `SECTION` (→ name as heading, recursed); `TABLE`/`TABLE_CELL` (→ cell text); `CONNECTOR` (→ label). Containers (`FRAME`/`GROUP`/`CANVAS`) are flattened inline. Multi-page files wrap each page as a section.
- **Reading order:** siblings sorted top-to-bottom then left-to-right (80px row tolerance) to approximate FigJam facilitation flow.
- **Output per board:** `data/workshops/<slug>.raw.md` (human-reviewable) + `.raw.json` (structured, with a `contentHash` for later change detection). A run also writes `_extract-report.json` (extracted + errors) and flags any board with `<3` text blocks as likely image/widget-heavy (fidelity risk).
- **Resilience & safety:** 429/5xx aware (honors `Retry-After`, exponential backoff, 5 attempts); paces requests (~400ms between files, 300ms between projects) to stay under rate limits; SSRF guard (only `api.figma.com`); errors are per-file (one bad board doesn't abort the run).
- **Usage:**
  ```powershell
  # Single-board fidelity test (run this FIRST):
  $env:FIGMA_TOKEN = "figd_…"
  node scripts/figma-extract.mjs --file "https://www.figma.com/board/KEY/Workshop-Name"

  # Full team run (after fidelity check passes):
  node scripts/figma-extract.mjs --team 1234567890
  ```
- **Cost:** Figma REST API is free; the only spend is the later normalization/embedding step (cents for all 40+).

The full script is in **Appendix A**; the source of truth is `scripts/figma-extract.mjs`.

## 9. Data model

- Reuse **`knowledge_base`** for approved guides (`source_type='workshop'`, `url`, `title`, `content`, `embedding`, `embedding_model`, `content_hash`). No new retrieval path.
- Optional provenance tags (discipline, deliverable) on the workshop rows for filtered retrieval — no separate table with a UI.
- Raw extracts + approved guides live in the repo under `data/workshops/` (version-controlled, reviewable, re-runnable).

## 10. Deliverables

- **D-1** `scripts/figma-extract.mjs` — team enumeration + per-board node-tree extraction (Appendix A). ✅ written.
- **D-2** Normalized coaching guides in `data/workshops/*.guide.md`, approved in-prompt.
- **D-3** Bulk-load migration/seed that upserts approved guides into `knowledge_base` + triggers embedding.
- **D-4** Retire `scrape-figma-workshops` and the Firecrawl-based `ingest-workshop-docs`.
- **D-5** Handbook coverage: rides on rearchitecture D-02 (`guide-ingest`) + its completeness gate (added there) proving every Project Success Handbook page (≈33) is ingested.

## 11. Acceptance criteria

- Given a workshop board, Fleety answers "how do I produce [its deliverable]?" with the concrete steps from that board and a citation to the board URL.
- `data/workshops/` contains a raw extract and an approved guide for every workshop in scope (40+).
- Zero Firecrawl / Lovable-gateway calls in the ingestion path.
- All ingested guides embed with `text-embedding-004`.
- **G-6 verified:** for an off-topic query (MW-08) Fleety does not answer from the web; for a genuine gap (MW-09) it states Tech Fleet has no data before any fallback, and any external content is labeled non-official.
- No new platform UI ships.

## 12. Decisions

- **Confirmed:** files live in a Figma team Morgan owns → auto-enumerate. Approval is **in-prompt with Claude**, not a platform UI. Incorporation is a **bulk load**. **Sequencing: rearchitecture first + QA, then this.**
- **Token timing:** create `FIGMA_TOKEN` right before Phase A (after rearchitecture QA) — not now.
- **Open — D-3:** G-6 fallback behavior — **Option A (honest, no web)** vs **Option B (gated, labeled web fallback)**. *Morgan to decide.*
- **Open:** does Morgan have rubrics/exemplar deliverables to ingest for coaching depth (§6)?

## 13. Morgan's effort

Create `FIGMA_TOKEN` (2 min, at Phase A) · send the team ID (1 min) · run the extract script once (1 command) · approve ~40 guides with Claude in-prompt (reviewing, not extracting). Optional: hand over rubrics/exemplars for deeper coaching.

---

## Appendix A — `scripts/figma-extract.mjs` (copy; source of truth is the file)

```javascript
#!/usr/bin/env node
// scripts/figma-extract.mjs
//
// Extract Tech Fleet workshop content from FigJam boards via the Figma REST API
// (Phase A). Reads the real board — sticky notes, sections, text, tables,
// connector labels — NOT the community landing page. No Firecrawl. Free API.
//
// Config (env only): FIGMA_TOKEN (required), FIGMA_TEAM_ID (optional default).
// Usage:
//   node scripts/figma-extract.mjs --file "https://www.figma.com/board/KEY/Name"
//   node scripts/figma-extract.mjs --team 1234567890
//   node scripts/figma-extract.mjs --project 987654321
// Options: --out <dir> (default data/workshops)  --limit <n>  --quiet
// Output: data/workshops/<slug>.raw.md + .raw.json  (+ _extract-report.json)

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const API = "https://api.figma.com/v1";
const TOKEN = process.env.FIGMA_TOKEN || "";

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
  console.error("FIGMA_TOKEN is not set. Figma → Settings → Security → Personal access tokens (file-read scope), then export FIGMA_TOKEN=...");
  process.exit(1);
}

async function figmaGet(pathname) {
  const url = `${API}${pathname}`;
  if (!url.startsWith(`${API}/`)) throw new Error(`Refusing non-Figma URL: ${url}`);
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

function fileKeyFromInput(input) {
  const m = String(input).match(/figma\.com\/(?:board|file|design)\/([A-Za-z0-9]+)/i);
  return m ? m[1] : String(input).trim();
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";
}

const TEXT_TYPES = new Set(["TEXT", "STICKY", "SHAPE_WITH_TEXT"]);
function nodeText(node) {
  if (typeof node.characters === "string" && node.characters.trim()) return node.characters.trim();
  return "";
}
function posOf(node) {
  const b = node.absoluteBoundingBox;
  return b ? { x: b.x ?? 0, y: b.y ?? 0 } : { x: 0, y: 0 };
}
function readingOrder(nodes) {
  const ROW = 80;
  return [...nodes].sort((a, b) => {
    const pa = posOf(a), pb = posOf(b);
    if (Math.abs(pa.y - pb.y) > ROW) return pa.y - pb.y;
    return pa.x - pb.x;
  });
}
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
      blocks.push(...walkChildren(node.children));
    } else {
      const text = nodeText(node);
      if (text) blocks.push({ kind: "text", text });
    }
  }
  return blocks;
}
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
      lines.push(`- ${b.text.replace(/\s*\n\s*/g, " / ")}`);
    }
  }
  return lines.join("\n");
}
function renderMarkdown(meta, blocks) {
  const header = [
    `# ${meta.name}`, "",
    `> Source: ${meta.url}`,
    `> File key: \`${meta.key}\` · Last modified: ${meta.lastModified ?? "?"} · Extracted: ${meta.extractedAt}`,
    `> Text blocks: ${meta.textBlockCount}`, "",
    "<!-- Raw extract from the Figma REST API (Phase A). Reviewed/normalized in Phase B. -->",
  ].join("\n");
  return `${header}\n${renderBlocks(blocks)}\n`;
}
async function extractFile(key, hintName, extractedAt, outDir) {
  const file = await figmaGet(`/files/${encodeURIComponent(key)}`);
  const name = file.name || hintName || key;
  const canvases = file.document?.children ?? [];
  let blocks = [];
  if (canvases.length <= 1) {
    blocks = walkChildren(canvases[0]?.children);
  } else {
    for (const canvas of canvases) {
      blocks.push({ kind: "section", name: `Page: ${canvas.name}`, children: walkChildren(canvas.children) });
    }
  }
  const textBlockCount = countTextBlocks(blocks);
  const meta = { key, name, url: `https://www.figma.com/board/${key}/`, lastModified: file.lastModified, extractedAt, textBlockCount };
  const structured = { meta, blocks };
  meta.contentHash = createHash("sha256").update(JSON.stringify(blocks)).digest("hex");
  const slug = slugify(name);
  await writeFile(path.join(outDir, `${slug}.raw.json`), JSON.stringify(structured, null, 2), "utf8");
  await writeFile(path.join(outDir, `${slug}.raw.md`), renderMarkdown(meta, blocks), "utf8");
  return { name, slug, textBlockCount };
}
async function listTeamFiles(teamId) {
  const { projects } = await figmaGet(`/teams/${encodeURIComponent(teamId)}/projects`);
  const files = [];
  for (const p of projects ?? []) {
    const res = await figmaGet(`/projects/${encodeURIComponent(p.id)}/files`);
    for (const f of res.files ?? []) files.push({ key: f.key, name: f.name, project: p.name });
    await sleep(300);
  }
  return files;
}
async function listProjectFiles(projectId) {
  const res = await figmaGet(`/projects/${encodeURIComponent(projectId)}/files`);
  return (res.files ?? []).map((f) => ({ key: f.key, name: f.name }));
}
async function main() {
  const outDir = path.resolve(process.cwd(), args.out);
  await mkdir(outDir, { recursive: true });
  const extractedAt = new Date().toISOString();
  let targets = [];
  if (args.file) targets = [{ key: fileKeyFromInput(args.file) }];
  else if (args.project) targets = await listProjectFiles(args.project);
  else {
    const teamId = args.team || process.env.FIGMA_TEAM_ID;
    if (!teamId) { console.error("Provide --file <url|key>, --project <id>, or --team <id> (or set FIGMA_TEAM_ID)."); process.exit(2); }
    targets = await listTeamFiles(teamId);
  }
  if (!targets.length) { console.error("No files found for the given target."); process.exit(1); }
  targets = targets.slice(0, args.limit);
  log(`Extracting ${targets.length} board(s) → ${outDir}\n`);
  const results = [], errors = [];
  for (const t of targets) {
    try {
      const r = await extractFile(t.key, t.name, extractedAt, outDir);
      log(`  ✓ ${r.name}  (${r.textBlockCount} text blocks) → ${r.slug}.raw.md`);
      results.push(r);
    } catch (e) {
      console.error(`  ✗ ${t.name || t.key}: ${e.message}`);
      errors.push({ key: t.key, name: t.name, error: e.message });
    }
    await sleep(400);
  }
  log(`\nDone: ${results.length} extracted, ${errors.length} failed.`);
  const emptyish = results.filter((r) => r.textBlockCount < 3);
  if (emptyish.length) {
    log(`\n⚠ ${emptyish.length} board(s) had <3 text blocks — likely image/widget-heavy. Review for fidelity:`);
    for (const r of emptyish) log(`   - ${r.name} (${r.slug})`);
  }
  await writeFile(path.join(outDir, "_extract-report.json"), JSON.stringify({ extractedAt, extracted: results, errors }, null, 2), "utf8");
  if (errors.length && !results.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
