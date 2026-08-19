// Shared, SSRF-guarded fetch of member-supplied material links. Single source of truth for the
// allow-list so the two surfaces that fetch member content — fleety-review (the coach endpoint)
// and techfleet-chat (in-chat "review my link") — can never drift apart.
//
// SECURITY (OWASP SSRF + DoS cheat sheets): https only; host must be on the allow-list (Figma or
// Tech Fleet's own domains); IP-literal + credentialed URLs rejected; caller MUST fetch with
// redirect:"error"; response is size- and time-bounded. The fetched bytes are UNTRUSTED DATA —
// callers frame them as data (never instructions) when they reach an LLM (prompt-injection defense).

// Reuse the ONE hardened Figma engine (the hand-off generator's): node-scoped fetch that pulls only
// the linked frame's subtree (so a 100k-node board never blows up), a streamed byte cap that can't
// OOM the worker, and 429/5xx retry. This is why Fleety can now read large boards the same way
// hand-off does — earlier it fetched the WHOLE file and choked on "too large".
import {
  fetchFileGroups,
  fetchNodesText,
  FigmaResponseTooLarge,
  parseFigmaUrl,
} from "../handoff-produce/figma.ts";

/** Hosts we will fetch a member's material from. NOTHING else. */
export const ALLOWED_MATERIAL_HOSTS = [
  "figma.com",
  "www.figma.com",
  "guide.techfleet.org",
  "techfleetworks.github.io",
] as const;

const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$|:/; // IPv4 or anything with a colon (IPv6)
const MAX_URL_LEN = 2048;
export const MATERIAL_FETCH_TIMEOUT_MS = 12_000;
export const MATERIAL_MAX_BYTES = 2_000_000; // 2 MB cap on fetched material (DoS)
/** Cap on extracted Figma text handed to the LLM (keeps the turn's context bounded). */
export const FIGMA_MAX_TEXT_CHARS = 40_000;

/** True iff `host` is exactly an allow-listed host or a subdomain of figma.com. */
function hostAllowed(host: string): boolean {
  return (
    (ALLOWED_MATERIAL_HOSTS as readonly string[]).includes(host) ||
    host === "figma.com" ||
    host.endsWith(".figma.com")
  );
}

/**
 * SSRF guard for a member-supplied material URL. Allow ONLY https to the pinned host allow-list.
 * Reject IP-literal hosts (defeats metadata/private-range tricks), credentialed URLs, and any
 * non-allow-listed host. Throws (message prefixed "SSRF:") on violation; callers MUST also fetch
 * with redirect:"error" so a 30x to an internal host can't slip past this check.
 */
export function assertMaterialUrlAllowed(url: string): void {
  if (typeof url !== "string" || url.length > MAX_URL_LEN) {
    throw new Error("SSRF: invalid or oversized URL");
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`SSRF: invalid URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new Error(`SSRF: must be https (${u.protocol})`);
  if (u.username || u.password) throw new Error("SSRF: credentials in URL not allowed");
  const host = u.hostname.toLowerCase();
  if (IP_LITERAL.test(host)) throw new Error(`SSRF: IP-literal host not allowed: ${host}`);
  if (!hostAllowed(host)) throw new Error(`SSRF: host not allow-listed: ${host}`);
}

/** Non-throwing predicate form of {@link assertMaterialUrlAllowed}. */
export function isMaterialUrlAllowed(url: string): boolean {
  try {
    assertMaterialUrlAllowed(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract up to `max` distinct allow-listed https URLs from free text (a chat message).
 * Only allow-listed URLs are returned, so a message mentioning a random link fetches nothing.
 */
export function extractAllowedUrls(text: string, max = 2): string[] {
  if (typeof text !== "string" || !text) return [];
  const candidates = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    // Trim trailing sentence punctuation a URL wouldn't normally end on.
    const url = raw.replace(/[.,;:!?)]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    if (isMaterialUrlAllowed(url)) {
      out.push(url);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * SSRF-guarded, bounded, no-redirect fetch of a member material URL → plain text.
 * Strips markup so an LLM reviews the content, not the HTML. Throws on violation/failure.
 */
export async function fetchMaterialText(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<string> {
  assertMaterialUrlAllowed(url); // throws on violation

  // Figma boards can't be read as a web page (that returns the app's JS bundle, not the design).
  // parseFigmaUrl throws on any non-figma URL, so guard it and fall through to the generic fetch.
  let figma: { fileKey: string; nodeId?: string } | null = null;
  try {
    figma = parseFigmaUrl(url);
  } catch {
    figma = null;
  }
  if (figma) {
    // Uses the Figma PAT already in prod (hand-off uses FIGMA_TOKEN), zero new config.
    // FLEETY_FIGMA_TOKEN is an optional override for a Fleety-specific PAT later.
    const figmaToken = Deno.env.get("FLEETY_FIGMA_TOKEN") || Deno.env.get("FIGMA_TOKEN");
    if (!figmaToken) {
      throw new Error(
        "figma: reading Figma boards isn't enabled yet — paste the key content or describe the board instead"
      );
    }
    try {
      let parts: string[];
      if (figma.nodeId) {
        // Node-scoped: the member linked a specific frame/section → fetch just that subtree.
        // This is how a huge board stays readable (the whole-file fetch is what hit "too large").
        const byId = await fetchNodesText(figma.fileKey, [figma.nodeId], figmaToken);
        parts = Object.values(byId).flat();
      } else {
        // No node in the link → grouped whole-file read (streamed under a hard byte cap).
        const groups = await fetchFileGroups(figma.fileKey, figmaToken);
        parts = groups.flatMap((g) => [`## ${g.name}`, ...g.text]);
      }
      const text = parts.join("\n").slice(0, FIGMA_MAX_TEXT_CHARS).trim();
      if (!text) throw new Error("figma: no readable text found on that board");
      return text;
    } catch (e) {
      if (e instanceof FigmaResponseTooLarge) {
        // Whole-file was too big — steer the member to link a specific frame so we go node-scoped.
        throw new Error(
          "figma: that board is very large — open the specific frame/section, right-click → Copy link to selection, and share THAT link so I can read just that part"
        );
      }
      throw e;
    }
  }

  const maxBytes = opts.maxBytes ?? MATERIAL_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? MATERIAL_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`fetch failed (HTTP ${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const bounded = buf.slice(0, maxBytes);
    return new TextDecoder()
      .decode(bounded)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    clearTimeout(timer);
  }
}
