/**
 * Canonicalize any thrown value into a real Error subclass.
 *
 * Catches the historical "[object Object]" bug class: Supabase RPC and
 * edge-function failures arrive as `{code, message, details, hint}` plain
 * objects. Throwing them directly (or stringifying naively) lost the message
 * and flooded the triage queue with un-actionable reports.
 *
 * Usage:
 *   try { ... } catch (e) { throw toError(e); }
 *   reportError(toError(unknownValue), 'source');
 */
import { AppError, AuthError, NetworkError, NotFoundError, RpcError, SerializationError, TimeoutError, ValidationError } from "./AppError";

interface SupabaseErrorShape {
  message?: unknown;
  error?: unknown;
  code?: unknown;
  hint?: unknown;
  details?: unknown;
  name?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickMessage(o: SupabaseErrorShape): string | undefined {
  const msg = o.message ?? o.error;
  if (typeof msg === "string" && msg.length > 0) return msg;
  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v as object)) return "[circular]";
        seen.add(v as object);
      }
      if (typeof v === "bigint") return v.toString();
      return v;
    });
    if (typeof json === "string" && json !== "{}" && json !== "[object Object]") return json;
  } catch { /* fall through */ }
  return "[unserializable value]";
}

/**
 * Map a Supabase Postgres error code to the correct AppError subclass when
 * possible; otherwise fall back to a generic AppError.
 */
function mapPgCodeToError(code: string, message: string, source?: string, cause?: unknown): AppError {
  // PGRST116 = no rows matched .single()
  if (code === "PGRST116") return new NotFoundError(source ?? "Row", { cause });
  // 23xxx = integrity constraint violations
  if (/^23\d{3}$/.test(code)) return new ValidationError(message, { details: { pgCode: code }, cause });
  // 42501 = permission denied
  if (code === "42501") return new AuthError(message, { cause });
  // 42883 = function does not exist (we surface as RpcError for actionable triage)
  if (code === "42883") return new RpcError(source ?? "unknown", message, { pgCode: code, cause });
  return new AppError(message, { code, cause });
}

export function toError(value: unknown, source?: string): AppError {
  // Already an AppError: pass through.
  if (value instanceof AppError) return value;

  // Native Error: wrap for known patterns, otherwise re-emit as AppError preserving cause.
  if (value instanceof Error) {
    // AbortError (DOMException or named Error) — surface as cancelled, retriable=false
    if (value.name === "AbortError") {
      return new AppError(value.message || "Operation aborted", { code: "aborted", retriable: false, cause: value });
    }
    // FunctionsFetchError from supabase-js
    if (value.name === "FunctionsFetchError" || /FunctionsFetchError/.test(value.message)) {
      return new NetworkError(value.message, { cause: value });
    }
    // TypeError: failed/network fetch
    if (value instanceof TypeError && /fetch|network/i.test(value.message)) {
      return new NetworkError(value.message, { cause: value });
    }
    if (/timeout/i.test(value.message)) {
      return new TimeoutError(value.message, { cause: value });
    }
    return new AppError(value.message, { code: value.name.toLowerCase(), cause: value });
  }

  // Plain Supabase shape: { code, message, details, hint }
  if (isObject(value)) {
    const obj = value as SupabaseErrorShape;
    const msg = pickMessage(obj);
    if (typeof obj.code === "string" && msg) {
      return mapPgCodeToError(obj.code, msg, source, value);
    }
    if (msg) return new AppError(msg, { code: typeof obj.code === "string" ? obj.code : "unknown", cause: value });
    // Last resort: stringify the shape so the reporter sees real data, not "[object Object]"
    return new SerializationError(`Non-Error thrown: ${safeStringify(value)}`, { cause: value });
  }

  if (typeof value === "string" && value.length > 0) return new AppError(value, { code: "string_thrown" });

  return new SerializationError(`Non-Error thrown: ${safeStringify(value)}`);
}
