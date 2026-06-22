/**
 * rpc-with-timeout — wrap a Supabase RPC call with a hard timeout so a wedged
 * PostgREST stream can never block UI render gates forever.
 *
 * Root-cause fix for the admin 2FA grace + Discord role retry RPCs hanging
 * indefinitely (see plan: "system is very slow, infinite spinner").
 *
 * Returns the standard `{ data, error }` shape so callers don't change.
 * On timeout, returns `{ data: null, error: { message, code: "RPC_TIMEOUT" } }`.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RpcTimeoutResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface RpcTimeoutOptions {
  /** ms before the call is abandoned. Default 8000. */
  timeoutMs?: number;
  /** Retry once on timeout. Default true. */
  retryOnTimeout?: boolean;
}

export async function rpcWithTimeout<T = unknown>(
  fn: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any> | undefined,
  opts: RpcTimeoutOptions = {},
): Promise<RpcTimeoutResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retry = opts.retryOnTimeout ?? true;

  const attempt = (): Promise<RpcTimeoutResult<T>> =>
    new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          data: null,
          error: { message: `rpc ${fn} exceeded ${timeoutMs}ms`, code: "RPC_TIMEOUT" },
        });
      }, timeoutMs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .rpc(fn, args)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((res: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ data: res?.data ?? null, error: res?.error ?? null });
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((err: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            data: null,
            error: { message: err instanceof Error ? err.message : String(err) },
          });
        });
    });

  const first = await attempt();
  if (first.error?.code === "RPC_TIMEOUT" && retry) {
    return await attempt();
  }
  return first;
}
