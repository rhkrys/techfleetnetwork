/**
 * Typed edge function invoker.
 *
 * Replaces direct `supabase.functions.invoke(...)` calls in app/service code
 * (enforced by ESLint rule `no-raw-functions-invoke`).
 *
 * Features:
 *   - AbortController timeout (default 8s). Aborted requests classify as
 *     transient and never reach the reporter (per structural classifier).
 *   - Single transparent retry on FunctionsFetchError / network TypeError
 *     after a 500ms backoff. Successful retry = 0 reports.
 *   - Optional Zod parsing of request body + response.
 *   - Throws typed `EdgeInvokeError` only when the call truly fails after
 *     the retry. Callers `try/catch` and branch on `instanceof EdgeInvokeError`.
 *
 * Trace headers are inherited from the existing `auditedInvoke` plumbing.
 */
import { supabase } from "@/integrations/supabase/client";
import { newTraceId, withTrace } from "@/lib/trace";
import { EdgeInvokeError, TimeoutError } from "@/lib/errors/AppError";
import { toError } from "@/lib/errors/toError";
import { classify } from "@/lib/observability/classify";
import { report } from "@/lib/observability/report";
import type { ZodSchema } from "zod";

export interface InvokeEdgeOptions<TIn = unknown, TOut = unknown> {
  /** Validated request body. */
  body?: TIn;
  /** Validate body before sending. Fails fast with ValidationError-like throw. */
  bodySchema?: ZodSchema<TIn>;
  /** Validate response data. */
  responseSchema?: ZodSchema<TOut>;
  /** Override timeout. Default 8000ms. */
  timeoutMs?: number;
  /** Disable the automatic single retry on network failure. */
  noRetry?: boolean;
  /** Extra headers (x-trace-id is added automatically). */
  headers?: Record<string, string>;
  /** Suppress reporting for expected failures (caller will handle classification). */
  silentReport?: boolean;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 500;

function isTransientNetwork(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === "FunctionsFetchError") return true;
  if (e.name === "AbortError") return false; // caller-initiated, not transient
  if (e.name === "TypeError" && /fetch|network|load failed/i.test(e.message ?? "")) return true;
  return false;
}

async function invokeOnce<TOut>(
  fn: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<TOut> {
  // The supabase JS client doesn't pass AbortSignal to invoke; we race manually.
  const callPromise = supabase.functions.invoke<TOut>(fn, { body, headers });
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new TimeoutError(`Edge function ${fn} timed out`)),
      { once: true },
    );
  });
  const result = await Promise.race([callPromise, abortPromise]);
  if (result.error) {
    const status = (result.error as { context?: { status?: number } }).context?.status;
    throw new EdgeInvokeError(fn, result.error.message ?? "edge invoke failed", {
      status,
      retriable: isTransientNetwork(result.error),
      cause: result.error,
    });
  }
  return result.data as TOut;
}

export async function invokeEdge<TOut = unknown, TIn = unknown>(
  fn: string,
  options: InvokeEdgeOptions<TIn, TOut> = {},
): Promise<TOut> {
  const traceId = newTraceId();
  const headers = { ...(options.headers ?? {}), "x-trace-id": traceId };

  let body = options.body as unknown;
  if (options.bodySchema && body !== undefined) {
    const parsed = options.bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new EdgeInvokeError(fn, `Invalid request body for ${fn}`, {
        status: 400,
        cause: parsed.error,
      });
    }
    body = parsed.data;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return withTrace(async () => {
    const attempt = async (): Promise<TOut> => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        return await invokeOnce<TOut>(fn, body, headers, ac.signal);
      } finally {
        clearTimeout(t);
      }
    };

    try {
      const raw = await attempt();
      if (options.responseSchema) {
        const parsed = options.responseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new EdgeInvokeError(fn, `Invalid response from ${fn}`, {
            status: 502,
            cause: parsed.error,
          });
        }
        return parsed.data;
      }
      return raw;
    } catch (err) {
      const normalized = toError(err);
      const retriable =
        !options.noRetry &&
        (isTransientNetwork(err) ||
          (err instanceof EdgeInvokeError && err.retriable));
      if (retriable) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        try {
          const raw = await attempt();
          if (options.responseSchema) {
            const parsed = options.responseSchema.safeParse(raw);
            if (!parsed.success) {
              throw new EdgeInvokeError(fn, `Invalid response from ${fn}`, {
                status: 502,
                cause: parsed.error,
              });
            }
            return parsed.data;
          }
          return raw;
        } catch (retryErr) {
          if (!options.silentReport && classify(retryErr).report) {
            report(retryErr, {
              source: `edge.${fn}`,
              eventType: "edge_invoke_failed",
              severity: "error",
              traceId,
            });
          }
          throw toError(retryErr);
        }
      }
      if (!options.silentReport && classify(err).report) {
        report(err, {
          source: `edge.${fn}`,
          eventType: "edge_invoke_failed",
          severity: "error",
          traceId,
        });
      }
      throw normalized;
    }
  });
}
