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
      reportActivity(
        "edge_invoke_failed",
        "edge.freescout-proxy",
        `freescout-proxy ${action} invoke_error`,
        {
          severity: "warn",
          traceId,
          extraFields: [`action:${safeField(action)}`, `reason:invoke_error`],
        },
      );
    }
    return result;
  } catch (err) {
    reportActivity(
      "edge_invoke_failed",
      "edge.freescout-proxy",
      `freescout-proxy ${action} transport_exception`,
      {
        severity: "warn",
        traceId,
        extraFields: [`action:${safeField(action)}`, `reason:transport_exception`],
      },
    );
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) } as const;
  }
}
