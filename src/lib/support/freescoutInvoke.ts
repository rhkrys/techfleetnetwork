import { supabase } from "@/integrations/supabase/client";
import { reportActivity } from "@/services/error-reporter.service";
import { newTraceId } from "@/lib/trace";

type FreescoutActionBody = Record<string, unknown> & { action?: unknown };

function safeField(value: unknown): string {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
}

export async function invokeFreescout<T = unknown>(body: FreescoutActionBody, signal?: AbortSignal) {
  const action = typeof body.action === "string" ? body.action : "unknown";
  const traceId = newTraceId();

  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) {
    // Route guard wraps /community/get-help, so missing token is a routing bug.
    // Surface it instead of papering over it.
    return { data: null, error: new Error("Not signed in.") } as const;
  }

  try {
    const result = await supabase.functions.invoke<T>("freescout-proxy", {
      body, signal,
      headers: { Authorization: `Bearer ${token}`, "x-trace-id": traceId },
    } as Parameters<typeof supabase.functions.invoke>[1]);
    if (result.error) {
      const extras: string[] = [`action:${safeField(action)}`, `reason:invoke_error`];
      // Best-effort: peek upstream error body for actionable triage detail.
      let sawContext = false;
      try {
        const ctx = (result.error as { context?: Response }).context;
        if (ctx && typeof ctx.clone === "function") {
          sawContext = true;
          const body = await ctx.clone().json().catch(() => null);
          const status = ctx.status;
          if (status) extras.push(`upstream:${safeField(String(status))}`);
          if (body && typeof body === "object") {
            const upstreamCode = (body as { error?: unknown }).error;
            if (upstreamCode) extras.push(`upstream_code:${safeField(String(upstreamCode))}`);
          }
        }
      } catch { /* best-effort only */ }
      if (!sawContext) {
        // No Response on the error = supabase-js never got a reply (function
        // undeployed, gateway 404, network blocked, CORS). Tag explicitly so
        // triage can tell "ran and failed" from "never ran" without cross-
        // referencing edge HTTP logs.
        extras.push(`upstream:transport_error`);
        const name = (result.error as { name?: string })?.name;
        if (name) extras.push(`error_name:${safeField(name)}`);
      }
      reportActivity(
        "edge_invoke_failed",
        "edge.freescout-proxy",
        `freescout-proxy ${action} invoke_error`,
        { severity: "warn", traceId, extraFields: extras },
      );
    }
    return result;
  } catch (err) {
    // Outer-catch tagging parity with the inner-error path: every
    // edge_invoke_failed row MUST carry an upstream:* tag so triage can
    // group transport vs HTTP-error vs auth failures. See plan §1.B.
    const errName = err instanceof Error ? err.name : "Unknown";
    reportActivity(
      "edge_invoke_failed",
      "edge.freescout-proxy",
      `freescout-proxy ${action} transport_exception`,
      {
        severity: "warn",
        traceId,
        extraFields: [
          `action:${safeField(action)}`,
          `reason:transport_exception`,
          `upstream:transport_error`,
          `error_name:${safeField(errName)}`,
        ],
      },
    );
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) } as const;
  }
}
