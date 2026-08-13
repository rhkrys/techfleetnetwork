// Figma / FigJam text extraction for hand-off ingest.
//
// THE FIX: teams put content ANYWHERE on a board — sticky notes, table cells (the biggest source),
// shapes, connector labels, code blocks, link cards, embeds, and hyperlinks buried in text runs —
// not only in the workshop template's TEXT nodes. So we do not allow-list node types. From EVERY
// node we collect: `characters`, `code`, a connector's nested label, the `name` of a link/embed/
// widget (that name IS the content), and every hyperlink URL (top-level or per-text-run). Decoration
// nodes (VECTOR, GROUP, RECTANGLE) carry none of these and are skipped for free. Nothing is dropped.
//
// Two modes, both used by the feature:
//  - per-node (fetchNodesText): a teammate submits a Figma link for one hand-off part -> the link
//    is the anchor -> we fetch exactly that node's subtree. Deterministic scope, no guessing.
//  - whole-file (groupByContainer over a fetched file): import a legacy board, grouped into
//    named sections, for the one-time auto-mapper.
//
// Network is host-locked to api.figma.com (SSRF guard). The walkers are pure + unit-tested.

const FIGMA_API = "https://api.figma.com/v1";
const CONTAINER_TYPES = new Set(["SECTION", "FRAME"]);

export type FigmaNode = {
  id?: string;
  name?: string;
  type?: string;
  characters?: string; // TEXT, STICKY, SHAPE_WITH_TEXT, TABLE_CELL, CONNECTOR, ...
  code?: string; // CODE_BLOCK
  text?: { characters?: string }; // some connectors nest their label here
  hyperlink?: { url?: string }; // a whole node linked to a URL
  styleOverrideTable?: Record<string, { hyperlink?: { url?: string } }>; // per-run hyperlinks in TEXT
  children?: FigmaNode[];
};

// Types whose `name` IS content (a link title, an embed source, a widget). For every OTHER type the
// name is a structural label ("Vector", "Group 633165") and must be ignored.
const NAME_IS_CONTENT = new Set(["LINK_UNFURL", "EMBED", "WIDGET"]);

/**
 * PURE: every string a node carries as CONTENT — never structural names.
 * We do NOT allow-list node types. Any node with `.characters` (or `.code`, or a nested connector
 * label) is content: TEXT, STICKY, SHAPE_WITH_TEXT, TABLE_CELL (tables!), CONNECTOR line labels,
 * and anything Figma adds later. Decoration nodes (VECTOR, GROUP, RECTANGLE, INSTANCE) have no
 * `.characters`, so they're skipped automatically. This is how we capture content the team put
 * ANYWHERE in the node, not only inside the workshop template's expected spots.
 */
function nodeTexts(n: FigmaNode): string[] {
  const out: string[] = [];
  if (typeof n.characters === "string" && n.characters.trim().length > 1)
    out.push(n.characters.trim());
  if (typeof n.code === "string" && n.code.trim().length > 1) out.push(n.code.trim());
  if (n.text && typeof n.text.characters === "string" && n.text.characters.trim().length > 1) {
    out.push(n.text.characters.trim());
  }
  // Link cards, embeds, and widgets keep their title/source in `name` — that is content.
  if (
    n.type &&
    NAME_IS_CONTENT.has(n.type) &&
    typeof n.name === "string" &&
    n.name.trim().length > 1
  ) {
    out.push(n.name.trim());
  }
  // Every hyperlink URL, including links whose visible text is a label rather than the URL itself.
  const urls = new Set<string>();
  if (n.hyperlink?.url) urls.add(n.hyperlink.url);
  for (const ov of Object.values(n.styleOverrideTable ?? {}))
    if (ov?.hyperlink?.url) urls.add(ov.hyperlink.url);
  for (const u of urls) out.push(u);
  return out;
}

/** PURE: EVERY word of content under a node, in document order. Walks the whole subtree. */
export function collectText(node: FigmaNode): string[] {
  const out: string[] = [];
  const walk = (n: FigmaNode) => {
    out.push(...nodeTexts(n));
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

/** PURE: group a whole document's text under the nearest named SECTION/FRAME (board import). */
export function groupByContainer(
  doc: FigmaNode
): Array<{ name: string; nodeId: string; text: string[] }> {
  const groups: Array<{ name: string; nodeId: string; text: string[] }> = [];
  const walk = (n: FigmaNode, current: { name: string; nodeId: string; text: string[] } | null) => {
    let ctx = current;
    if (n.type && CONTAINER_TYPES.has(n.type) && n.name && n.id) {
      ctx = { name: n.name, nodeId: n.id, text: [] };
      groups.push(ctx);
    }
    if (ctx) ctx.text.push(...nodeTexts(n));
    for (const c of n.children ?? []) walk(c, ctx);
  };
  walk(doc, null);
  return groups.filter((g) => g.text.length);
}

/** node-id in a Figma URL uses a dash; the API uses a colon. Accept either, validate shape. */
export function normalizeNodeId(raw: string): string {
  const id = raw.trim().replace(/-/, ":");
  if (!/^[\w:;]+$/.test(id)) throw new Error(`invalid figma node id: ${raw}`);
  return id;
}

function assertFileKey(k: string): void {
  if (!/^[A-Za-z0-9]+$/.test(k)) throw new Error("invalid figma file key");
}

/** PURE: parse a submitted Figma/FigJam URL into {fileKey, nodeId?}. Host-locked to figma.com
 *  (SSRF defense — a submitted link is untrusted). This turns a teammate's pasted link into the
 *  exact anchor we fetch, so extraction is a scoped lookup, never a board-wide crawl. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "https:" || !/(^|\.)figma\.com$/i.test(u.hostname))
    throw new Error("not an https figma.com URL");
  const m = u.pathname.match(/\/(?:file|board|design|proto)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error("no figma file key in URL");
  const raw = u.searchParams.get("node-id");
  return { fileKey: m[1], nodeId: raw ? normalizeNodeId(raw) : undefined };
}

// --- production fetch: node-scoped, batched, timeout + retry that waits out 429 / 5xx. At
// 5-10 projects/month this is a handful of calls; the batching + caching keep it far under limits
// and keep payloads small (we never pull the whole 100k-node board on the hot path). ---
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 5;
const MAX_WAIT_MS = 20_000;
const MAX_IDS_PER_CALL = 50; // keep the ?ids= query well under URL-length limits

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function retryAfterMs(h: Headers): number | null {
  const ra = h.get("retry-after");
  if (!ra) return null;
  const n = Number(ra.trim());
  return Number.isFinite(n) ? n * 1000 : null;
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Host-locked, timeout-bounded GET that waits out 429 / 5xx (honoring Retry-After) then retries. */
async function figmaGet(path: string, token: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${FIGMA_API}${path}`, {
        signal: controller.signal,
        headers: { "X-Figma-Token": token },
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(retryAfterMs(res.headers) ?? 1000 * attempt, MAX_WAIT_MS);
        if (attempt < MAX_RETRIES) {
          await sleep(wait + Math.floor(Math.random() * 300));
          continue;
        }
        throw new Error(`figma HTTP ${res.status} after ${MAX_RETRIES} attempts`);
      }
      if (!res.ok) throw new Error(`figma HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES)
        await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 300));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`figma fetch failed: ${String(lastErr)}`);
}

/** IMPURE: fetch specific nodes' text (the per-part submitted-link flow). Batched + retry-aware. */
export async function fetchNodesText(
  fileKey: string,
  nodeIds: string[],
  token: string
): Promise<Record<string, string[]>> {
  assertFileKey(fileKey);
  const ids = [...new Set(nodeIds.map(normalizeNodeId))];
  const out: Record<string, string[]> = {};
  for (const batch of chunk(ids, MAX_IDS_PER_CALL)) {
    const data = (await figmaGet(`/files/${fileKey}/nodes?ids=${batch.join(",")}`, token)) as {
      nodes?: Record<string, { document?: FigmaNode }>;
    };
    for (const [id, wrap] of Object.entries(data.nodes ?? {}))
      if (wrap.document) out[id] = collectText(wrap.document);
  }
  return out;
}

/** IMPURE: fetch the whole file document (one-time board import / auto-mapper only). Retry-aware. */
export async function fetchFileGroups(
  fileKey: string,
  token: string
): Promise<Array<{ name: string; nodeId: string; text: string[] }>> {
  assertFileKey(fileKey);
  const data = (await figmaGet(`/files/${fileKey}`, token)) as { document?: FigmaNode };
  return data.document ? groupByContainer(data.document) : [];
}
