/**
 * Part 1 §1.2 — Server-side idempotency wrapper for Supabase Edge Functions.
 *
 * Usage:
 *   import { withIdempotency } from "../_shared/idempotency.ts";
 *
 *   serve(async (req) => {
 *     return withIdempotency(req, supabase, async () => {
 *       // your handler that performs the mutation
 *       return new Response(JSON.stringify({ ok: true }), { status: 200 });
 *     });
 *   });
 *
 * Behavior:
 *   - Reads `X-Request-Id` (or `X-Idempotency-Key`) from the incoming request.
 *   - If absent, calls handler normally (no caching) — useful for read paths.
 *   - If present, calls `claim_idempotency_key`; on a cache hit returns the
 *     stored response immediately. On first-call, executes the handler then
 *     records the response via `complete_idempotency`.
 *   - The request hash is `method:path:body-sha256` so accidental key reuse
 *     with a different payload throws instead of silently returning the old
 *     response.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const KEY_HEADER_PRIMARY = "x-request-id";
const KEY_HEADER_FALLBACK = "x-idempotency-key";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface WithIdempotencyOptions {
  /** TTL the cached response lives for, in minutes. Default 1440 (24h). */
  ttlMinutes?: number;
  /** Optional user id; if omitted, parsed from JWT (`sub`). */
  userId?: string | null;
  /** Override the key (e.g., for cron workers that compose their own). */
  explicitKey?: string;
}

function readUserIdFromJwt(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function withIdempotency(
  req: Request,
  supabase: SupabaseClient,
  handler: () => Promise<Response>,
  opts: WithIdempotencyOptions = {},
): Promise<Response> {
  const key =
    opts.explicitKey ??
    req.headers.get(KEY_HEADER_PRIMARY) ??
    req.headers.get(KEY_HEADER_FALLBACK);

  // No key: behave transparently.
  if (!key || key.length < 8) {
    return handler();
  }

  const userId = opts.userId !== undefined ? opts.userId : readUserIdFromJwt(req);

  // Hash the request shape so reuse with a different payload throws.
  let body = "";
  try {
    body = await req.clone().text();
  } catch {
    body = "";
  }
  const url = new URL(req.url);
  const requestHash = await sha256Hex(`${req.method}:${url.pathname}:${body}`);

  const { data: claim, error: claimErr } = await supabase.rpc("claim_idempotency_key", {
    p_key: key,
    p_user_id: userId,
    p_request_hash: requestHash,
    p_ttl_minutes: opts.ttlMinutes ?? 1440,
  });

  if (claimErr) {
    // Idempotency tracking failed — fall through to the handler so we don't
    // brick the request. Log via response header so ops can grep.
    const r = await handler();
    r.headers.set("X-Idempotency-Error", claimErr.message.slice(0, 120));
    return r;
  }

  const row = Array.isArray(claim) ? claim[0] : claim;
  if (row && row.claimed === false && row.cached_response) {
    // Cache hit — replay stored response.
    const body = JSON.stringify(row.cached_response);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Idempotent-Replay": "1",
      },
    });
  }

  // First call — run handler and record result.
  let response: Response;
  try {
    response = await handler();
  } catch (err) {
    await supabase.rpc("complete_idempotency", {
      p_key: key,
      p_response: { error: String(err) },
      p_status: "failed",
    });
    throw err;
  }

  // Only cache JSON 2xx responses; pass others through without storing.
  if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
    try {
      const clone = response.clone();
      const json = await clone.json();
      await supabase.rpc("complete_idempotency", {
        p_key: key,
        p_response: json,
        p_status: "complete",
      });
    } catch {
      // ignore — response is still returned to caller
    }
  }

  response.headers.set("X-Request-Id", key);
  return response;
}
