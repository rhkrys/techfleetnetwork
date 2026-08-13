// PURE validators for hand-off submissions (Phase B1). No I/O -> unit-tested offline.
// OWASP file-upload controls: type is decided by MAGIC BYTES (never the client extension/mime),
// size is capped server-side, the stored name is random, links are scheme/host checked, text is
// capped at 10k. ZIP-container office files (xlsx/docx) are DETECTED but REFUSED for now: they
// carry decompression-bomb + XXE risk we don't yet guard (threat-model T4). We refuse the type
// we can't secure yet rather than accept it unguarded; CSV covers spreadsheet data meanwhile.

export const MAX_TEXT_LEN = 10_000;
export const MAX_FILE_BYTES = 52_428_800; // 50 MB (matches the bucket limit)

export type FileCategory = "pdf" | "png" | "jpeg" | "zip-office" | "text";
/** Categories we currently accept (no decompression/XXE exposure). */
export const ALLOWED_CATEGORIES: ReadonlySet<FileCategory> = new Set([
  "pdf",
  "png",
  "jpeg",
  "text",
]);

export const CATEGORY_MIME: Record<FileCategory, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  "zip-office": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  text: "text/plain",
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/** Detect the true type from content. Returns null if it matches no known binary signature and
 *  isn't valid UTF-8 text (CSV/TXT have no magic bytes). */
export function sniffCategory(bytes: Uint8Array): FileCategory | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip-office"; // PK.. (xlsx/docx/zip)
  if (isProbablyUtf8Text(bytes)) return "text";
  return null;
}

/** Decodes as strict UTF-8 and contains no control chars other than tab/newline/CR. */
export function isProbablyUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s);
  } catch {
    return false;
  }
}

export type UploadCheck =
  { ok: true; category: FileCategory; mime: string } | { ok: false; error: string };

export function checkUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) return { ok: false, error: "empty file" };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "file exceeds 50 MB limit" };
  const category = sniffCategory(bytes);
  if (!category)
    return { ok: false, error: "unsupported or unrecognized file type (content check failed)" };
  if (!ALLOWED_CATEGORIES.has(category)) {
    // xlsx/docx detected: refused until decompression + XXE hardening lands (T4).
    return {
      ok: false,
      error: "Word/Excel files aren't supported yet. Export to PDF or CSV, or paste as text.",
    };
  }
  return { ok: true, category, mime: CATEGORY_MIME[category] };
}

export type UrlCheck = { ok: true } | { ok: false; error: string };
const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com"]);

/** Validate a link submission. figma/figjam must be a Figma host; url must be https and not an
 *  obviously-internal host. (Deep SSRF resolve-and-check happens at fetch time, not store time.) */
export function checkSubmissionUrl(type: "figma" | "figjam" | "url", raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "invalid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "URL must be https" };
  const host = u.hostname.toLowerCase();
  if (type === "figma" || type === "figjam") {
    if (!FIGMA_HOSTS.has(host)) return { ok: false, error: "must be a figma.com link" };
  } else if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "169.254.169.254" ||
    /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  ) {
    return { ok: false, error: "internal/private hosts are not allowed" };
  }
  return { ok: true };
}

export function checkText(text: string): { ok: true } | { ok: false; error: string } {
  const t = (text ?? "").trim();
  if (!t) return { ok: false, error: "text is empty" };
  if (t.length > MAX_TEXT_LEN)
    return { ok: false, error: `text exceeds ${MAX_TEXT_LEN} characters` };
  return { ok: true };
}

/** Random, safe object name — never trust the client filename for the stored path. */
export function safeObjectName(category: FileCategory, seed: string): string {
  const rand = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "file";
  const ext = category === "jpeg" ? "jpg" : category === "text" ? "txt" : category;
  return `${rand}.${ext}`;
}
