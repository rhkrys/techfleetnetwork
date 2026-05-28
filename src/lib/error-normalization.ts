type NormalizedError = Error & {
  code?: string;
  details?: string;
  hint?: string;
  status?: string | number;
};

const FIELD_LIMIT = 700;

function safeSerialize(value: unknown): string | null {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, current) => {
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
          code: (current as NormalizedError).code,
        };
      }
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[Circular]";
        seen.add(current);
      }
      return current;
    });
  } catch {
    return null;
  }
}

function readable(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value) return null;
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return readable(obj.message) ?? readable(obj.error) ?? safeSerialize(obj);
  }
  return String(value);
}

function field(label: string, value: unknown): string | null {
  const text = readable(value);
  if (!text) return null;
  return `${label}=${text.slice(0, FIELD_LIMIT)}`;
}

export function normalizeThrownError(value: unknown, fallback = "Unknown error"): NormalizedError {
  if (value instanceof Error && value.message && value.message !== "[object Object]") return value as NormalizedError;

  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const parts = obj
    ? [
        readable(obj.message),
        field("code", obj.code),
        field("details", obj.details),
        field("hint", obj.hint),
        field("status", obj.status),
        field("error", obj.error),
      ].filter((part): part is string => Boolean(part))
    : [readable(value)].filter((part): part is string => Boolean(part));

  const message = parts.length > 0
    ? parts.join(" | ")
    : safeSerialize(value) ?? fallback;
  const err = new Error(message && message !== "[object Object]" ? message : fallback) as NormalizedError;

  if (obj) {
    if (typeof obj.name === "string") err.name = obj.name;
    if (typeof obj.stack === "string") err.stack = obj.stack;
    if (typeof obj.code === "string") err.code = obj.code;
    if (typeof obj.details === "string") err.details = obj.details;
    if (typeof obj.hint === "string") err.hint = obj.hint;
    if (typeof obj.status === "string" || typeof obj.status === "number") err.status = obj.status;
  }

  return err;
}

export function formatThrowable(value: unknown): string {
  const err = normalizeThrownError(value);
  return `${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`;
}