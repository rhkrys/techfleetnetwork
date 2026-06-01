import { supabase } from "@/integrations/supabase/client";
import { reportActivity } from "@/services/error-reporter.service";
import { newTraceId } from "@/lib/trace";

type FreescoutActionBody = Record<string, unknown> & { action?: unknown };

const SESSION_RETRY_DELAYS_MS = [0, 100, 300] as const;

function safeField(value: unknown): string {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
}

async function readAccessToken(): Promise<string | null> {
  for (const delay of SESSION_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) return token;
  }
  return null;
}

function logInvokeFailure(reason: string, action: string, traceId: string, err?: unknown) {
  const maybe = err as { name?: string; message?: string; context?: { status?: number } } | null;
  reportActivity(
    "edge_invoke_failed",
    "edge.freescout-proxy",
    `freescout-proxy ${action} ${reason}`,
    {
      severity: "warn",
      traceId,
      extraFields: [
        `action:${safeField(action)}`,
        `reason:${safeField(reason)}`,
        ...(maybe?.name ? [`error_name:${safeField(maybe.name)}`] : []),
        ...(maybe?.context?.status ? [`status:${safeField(maybe.context.status)}`] : []),
      ],
    },
  );
}

export async function invokeFreescout<T = any>(body: FreescoutActionBody, signal?: AbortSignal) {
  const action = typeof body.action === "string" ? body.action : "unknown";
  const traceId = newTraceId();
  const token = await readAccessToken();

  if (!token) {
    logInvokeFailure("missing_client_session", action, traceId);
    return { data: null, error: new Error("Your session is still starting. Please wait a moment and try again.") } as const;
  }

  try {
    const result = await supabase.functions.invoke<T>("freescout-proxy", {
      body,
      signal,
      headers: { Authorization: `Bearer ${token}`, "x-trace-id": traceId },
    } as any);
    if (result.error) logInvokeFailure("invoke_error", action, traceId, result.error);
    return result;
  } catch (err) {
    logInvokeFailure("transport_exception", action, traceId, err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) } as const;
  }
}