// Figma REST-API extraction for member-supplied board links. The generic material fetcher
// (`fetchMaterialText`) pulls a figma.com URL as a web page — which returns the Figma web-app's
// JS bundle ("a bunch of code"), NOT the design. To read the actual board we must call the Figma
// REST API (`GET /v1/files/:key`) with an X-Figma-Token and walk the document tree into text.
//
// SECURITY (OWASP SSRF + DoS + LLM untrusted-content):
//   - Fixed egress: we only ever call the constant host `api.figma.com` over https, never a
//     member-controlled host. The board URL is used ONLY to parse a file key (no fetch of it here).
//   - The token is read by the caller from the environment and passed in; it is NEVER logged and
//     never echoed into returned text.
//   - Bounded: shallow `depth` on the API call + byte cap + timeout + output-char cap, so a huge
//     board cannot exhaust memory (this is the ADR-0006/0007 lesson — no unbounded Figma load).
//   - The returned text is UNTRUSTED DATA. Callers MUST frame it as data (never instructions) when
//     it reaches an LLM (prompt-injection defense) — same contract as fetchMaterialText.

/** Byte cap on the Figma API JSON response. Larger than the 2 MB HTML cap because file JSON is
 *  bigger, but still bounded so a giant board can't OOM the isolate. */
export const FIGMA_MAX_BYTES = 8_000_000;
/** Wall-clock cap on the Figma API call. */
export const FIGMA_TIMEOUT_MS = 15_000;
/** Cap on the extracted text handed back to the caller (keeps LLM context bounded). */
export const FIGMA_MAX_TEXT_CHARS = 40_000;
/** How deep to traverse the document tree via the API's `depth` param. */
export const FIGMA_API_DEPTH = 4;

/**
 * Parse a Figma file/board key from a member-supplied URL. Returns null for any non-Figma URL or a
 * Figma URL that isn't a file/design/board/proto link (e.g. the marketing site). Pure — no I/O.
 */
export function parseFigmaKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!(host === "figma.com" || host.endsWith(".figma.com"))) return null;
  // /file/:key/…, /design/:key/…, /board/:key/… (FigJam), /proto/:key/…
  const m = u.pathname.match(/\/(?:file|design|board|proto)\/([A-Za-z0-9]{8,})/);
  return m ? m[1] : null;
}

type FigmaNode = {
  type?: string;
  name?: string;
  characters?: string;
  children?: FigmaNode[];
};

/**
 * Flatten a Figma file document tree into readable text: structural container names become light
 * headings and TEXT nodes contribute their characters, in document order. Bounded by `maxChars`.
 * Pure — no I/O. Defensive against arbitrary shapes (untrusted API response).
 */
export function figmaNodesToText(fileJson: unknown, maxChars = FIGMA_MAX_TEXT_CHARS): string {
  const out: string[] = [];
  let total = 0;
  const CONTAINER = new Set([
    "CANVAS",
    "FRAME",
    "SECTION",
    "GROUP",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
  ]);

  const push = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (total + trimmed.length > maxChars) return false;
    out.push(trimmed);
    total += trimmed.length + 1;
    return true;
  };

  const visit = (node: FigmaNode | undefined, depth: number): boolean => {
    if (!node || typeof node !== "object") return true;
    const type = typeof node.type === "string" ? node.type : "";
    const name = typeof node.name === "string" ? node.name : "";
    if (type === "TEXT" && typeof node.characters === "string") {
      if (!push(node.characters)) return false;
    } else if (name && CONTAINER.has(type)) {
      if (!push(`${"#".repeat(Math.min(depth + 1, 4))} ${name}`)) return false;
    }
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const k of kids) {
      if (!visit(k, depth + 1)) return false;
    }
    return true;
  };

  const root = fileJson as { name?: unknown; document?: FigmaNode } | null;
  if (root && typeof root === "object") {
    if (typeof root.name === "string") push(`# ${root.name}`);
    visit(root.document, 0);
  }
  return out.join("\n").slice(0, maxChars).trim();
}

/**
 * Fetch a member's Figma board via the Figma REST API and return its readable content as text.
 * Throws (message prefixed "figma:") on a missing key, an access failure, or an unreadable board.
 * The caller supplies `token` from the environment (never hard-coded, never logged here).
 */
export async function fetchFigmaContent(
  url: string,
  token: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxChars?: number } = {}
): Promise<string> {
  const key = parseFigmaKey(url);
  if (!key) throw new Error("figma: could not read a file key from that link");
  if (!token) throw new Error("figma: no API token configured");

  const api = `https://api.figma.com/v1/files/${key}?depth=${FIGMA_API_DEPTH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FIGMA_TIMEOUT_MS);
  try {
    const res = await fetch(api, {
      headers: { "X-Figma-Token": token },
      signal: controller.signal,
      redirect: "error",
    });
    if (res.status === 403 || res.status === 404) {
      throw new Error(
        "figma: that board isn't shared with Fleety (invite the Fleety integration or make it link-viewable)"
      );
    }
    if (res.status === 429) throw new Error("figma: rate-limited by Figma, try again shortly");
    if (!res.ok) throw new Error(`figma: API error (HTTP ${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const bounded = buf.slice(0, opts.maxBytes ?? FIGMA_MAX_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bounded));
    } catch {
      throw new Error("figma: board is too large or the response was malformed to read");
    }
    const text = figmaNodesToText(json, opts.maxChars ?? FIGMA_MAX_TEXT_CHARS);
    if (!text) throw new Error("figma: no readable text found on that board");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
