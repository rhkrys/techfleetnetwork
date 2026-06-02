/**
 * Audited wrapper for `supabase.functions.invoke`.
 *
 * Adds an `x-trace-id` header so the edge function can re-emit audit events
 * under the same correlation id, and writes a `client_error` row whenever
 * the invoke returns an error or throws — without changing the call signature.
 */
import { supabase } from "@/integrations/supabase/client";
import { reportError } from "@/services/error-reporter.service";
import { newTraceId, withTrace } from "@/lib/trace";
import type { FunctionInvokeOptions, FunctionsResponse } from "@supabase/functions-js";

export async function auditedInvoke<T = unknown>(
  fn: string,
  options: FunctionInvokeOptions = {},
): Promise<FunctionsResponse<T>> {
  const traceId = newTraceId();
  const headers = {
    ...(options.headers ?? {}),
    "x-trace-id": traceId,
  };
  return await withTrace(async (): Promise<FunctionsResponse<T>> => {
    try {
      const result = await supabase.functions.invoke<T>(fn, { ...options, headers });
      if (result.error) {
        // Severity is `warn` (not `error`) because client-side invoke failures
        // are almost always transport-layer (CORS preflight, network drop,
        // 4xx from validation) — not actionable code bugs. Genuine bugs are
        // logged at `error` severity by the edge function itself via its own
        // audit path, so triage stays high-signal. See HELP-DESK-024.
        reportError(
          `${fn}: ${result.error.message ?? String(result.error)}`,
          `edge.${fn}`,
          { eventType: "edge_invoke_failed", severity: "warn", traceId },
        );
      }
      return result;
    } catch (err) {
      reportError(err, `edge.${fn}`, {
        eventType: "edge_invoke_failed",
        severity: "warn",
        traceId,
      });
      throw err;
    }
  });
}
