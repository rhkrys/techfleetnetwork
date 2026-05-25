import { z } from "zod";
import { deepSanitize, enforceMaxBytes, hasActiveXssPattern, hasHeaderInjection, hasPathTraversal, hasSqlInjectionPattern, sanitizeHtml } from "@/lib/security";

const SAFE_TEXT_MAX_BYTES = 50_000;

/**
 * Classifies the *type* of unsafe content so we can give users an
 * actionable, recoverable error message (Heuristic #9) instead of the
 * generic "contains unsafe content".
 *
 * `allowNewlines=true` is for body/paragraph fields where `\n`/`\r\n`
 * are legal. Header-injection checks (CR/LF) only apply to single-line
 * fields that may end up in HTTP headers, URLs, or filenames.
 */
function classifyUnsafe(value: string, allowNewlines: boolean): string | null {
  if (hasActiveXssPattern(value)) return "looks like an HTML/script tag — remove angle brackets and try again";
  if (hasPathTraversal(value)) return "looks like a file path traversal sequence (../) — remove it and try again";
  if (hasSqlInjectionPattern(value)) return "looks like a SQL keyword sequence — rephrase without keywords like UNION SELECT or OR 1=1";
  if (!allowNewlines && hasHeaderInjection(value)) return "must be on a single line — remove line breaks and try again";
  return null;
}

function attachUnsafeIssue(label: string, allowNewlines: boolean) {
  return (value: string, ctx: z.RefinementCtx) => {
    const reason = classifyUnsafe(value, allowNewlines);
    if (reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ${reason}` });
    }
  };
}

export function normalizeSafeText(value: string, maxBytes = SAFE_TEXT_MAX_BYTES) {
  return enforceMaxBytes(value.trim(), maxBytes);
}

export const safeShortTextSchema = (label: string, max = 200) =>
  z.string().trim().max(max, `${label} must be under ${max} characters`).superRefine(attachUnsafeIssue(label, false));

export const safeRequiredTextSchema = (label: string, max = 2_000) => safeShortTextSchema(label, max).pipe(z.string().min(1, `${label} is required`));

/** Long-form / paragraph text. Allows newlines (header-injection check skipped). */
export const safeLongTextSchema = (label: string, max = 10_000) =>
  z.string().trim().max(max, `${label} must be under ${max} characters`).superRefine(attachUnsafeIssue(label, true));

/** Explicit alias for multi-paragraph body fields (feedback, professional goals, etc.). */
export const safeMultilineTextSchema = safeLongTextSchema;

export const safeHtmlSchema = (label: string, max = 100_000) => z.string().max(max, `${label} must be under ${max} characters`).transform((value) => sanitizeHtml(value));

export const safeUrlSchema = (label: string, max = 500) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed === "") return "";
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      // Force https:// for everything else (typos like "htp://...", scheme-less
      // domains, accidental "linkedin.com:in/..."). Members shouldn't have to
      // think about the protocol — and obviously dangerous inputs like
      // javascript:/data: still fail the refine below.
      const stripped = trimmed.replace(/^\/+/, "");
      return `https://${stripped}`;
    },
    z.string().trim().max(max, `${label} must be under ${max} characters`).refine((value) => value === "" || /^https?:\/\/.+/i.test(value), `${label} must start with http:// or https://`).superRefine(attachUnsafeIssue(label, false)),
  );

export const safeStringArraySchema = (label: string, maxItems = 30, maxItemLength = 200) => z.array(safeShortTextSchema(label, maxItemLength)).max(maxItems, `Too many ${label.toLowerCase()} selected`);

export function sanitizeRecordFields(fields: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") sanitized[key] = deepSanitize(normalizeSafeText(value));
    else if (Array.isArray(value)) sanitized[key] = value.map((item) => (typeof item === "string" ? deepSanitize(normalizeSafeText(item, 2_000)) : item));
    else sanitized[key] = deepSanitize(value);
  }
  return sanitized;
}