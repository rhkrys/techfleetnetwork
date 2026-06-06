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
import manifest from "@/generated/edge-functions.manifest.json";

// AUTH-PIN-001: derived from supabase/functions.manifest.json — the single
// source of truth maintained by scripts/ci/check-edge-function-coverage.mjs.
// Mark a function critical by adding `// @edge-auth required` to the first
// 15 lines of its index.ts (or, transitionally, add it to CRITICAL_FALLBACK
// in the generator). When a critical function 404s, we bump severity to
// `error` + emit `fingerprint:edge_function_not_deployed:<name>` so the
// 5-minute Triage Critical Push pages admins on the FIRST occurrence.
const AUTH_CRITICAL = new Set<string>(
  (manifest as { functions: Array<{ name: string; critical?: boolean }> }).functions
    .filter((f) => f.critical)
    .map((f) => f.name),
);

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
        const ctx = (result.error as { context?: Response }).context;
        const status = ctx && typeof ctx.status === "number" ? ctx.status : undefined;
        const upstream = status ? `upstream:${status}` : `upstream:transport_error`;
        const isUndeployed = AUTH_CRITICAL.has(fn) && (status === 404 || status === undefined);
        const severity: "warn" | "error" = isUndeployed ? "error" : "warn";
        const extraFields = isUndeployed
          ? [upstream, `severity:error`, `fingerprint:edge_function_not_deployed:${fn}`]
          : [upstream];
        // Severity is `warn` (not `error`) for ordinary invoke failures —
        // transport-layer noise (CORS preflight, network drop, 4xx
        // validation) is not actionable. Real edge bugs are logged at
        // `error` severity by the edge function itself. AUTH_CRITICAL 404 /
        // transport bumps to `error` so admins are paged immediately.
        reportError(
          `${fn}: ${result.error.message ?? String(result.error)}`,
          `edge.${fn}`,
          { eventType: "edge_invoke_failed", severity, traceId, extraFields },
        );
      }
      return result;
    } catch (err) {
      const errName = err instanceof Error ? err.name : "Unknown";
      const isUndeployed = AUTH_CRITICAL.has(fn);
      const severity: "warn" | "error" = isUndeployed ? "error" : "warn";
      const extraFields = isUndeployed
        ? [`upstream:transport_error`, `error_name:${errName}`, `severity:error`, `fingerprint:edge_function_not_deployed:${fn}`]
        : [`upstream:transport_error`, `error_name:${errName}`];
      reportError(err, `edge.${fn}`, {
        eventType: "edge_invoke_failed",
        severity,
        traceId,
        extraFields,
      });
      throw err;
    }
  });
}
