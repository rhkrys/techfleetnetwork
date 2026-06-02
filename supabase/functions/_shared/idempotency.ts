// Shared idempotency helper for mutating edge functions.
// Wave 1 of the comprehensive refactor — see plan §1.2.
//
// Usage:
//   import { withIdempotency } from "../_shared/idempotency.ts";
//   return withIdempotency(req, supabaseAdmin, async () => {
//     // ... do mutation, return Response ...
//   });
//
// Behavior:
//   - Reads X-Request-Id (or X-Idempotency-Key) from the incoming request.
//   - If absent, runs the handler normally (no dedupe).
//   - If present, hashes the request body and looks up request_idempotency.
//     * Hit + same hash → replays the cached response.
//     * Hit + different hash → 409 Conflict (key reuse with different body).
//     * Miss → runs handler, stores the response, returns it.
//   - Rows expire after 24h via request_idempotency.expires_at.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEY_HEADERS = ["x-request-id", "x-idempotency-key"];

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractKey(req: Request): string | null {
  for (const h of KEY_HEADERS) {
    const v = req.headers.get(h);
    if (v && v.length >= 8 && v.length <= 200) return v.trim();
  }
  return null;
}

export interface IdempotencyOptions {
  /** Override the user id stored on the cache row. Defaults to null. */
  userId?: string | null;
  /** Cache TTL in seconds. Default 24h. */
  ttlSeconds?: number;
}

export async function withIdempotency(
  req: Request,
  supabase: SupabaseClient,
  handler: () => Promise<Response>,
  opts: IdempotencyOptions = {},
): Promise<Response> {
  const key = extractKey(req);
  if (!key) return handler();

  // Hash the body so a replay with a different payload is rejected.
  const clone = req.clone();
  let body = "";
  try {
    body = await clone.text();
  } catch {
    body = "";
  }
  const hash = await sha256Hex(`${req.method} ${new URL(req.url).pathname} ${body}`);

  // Lookup
  const { data: existing, error: lookupErr } = await supabase
    .from("request_idempotency")
    .select("request_hash, response_json, status_code")
    .eq("key", key)
    .maybeSingle();

  if (!lookupErr && existing) {
    if (existing.request_hash !== hash) {
      return new Response(
        JSON.stringify({ error: "idempotency_key_reused_with_different_payload" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(existing.response_json ?? {}), {
      status: existing.status_code ?? 200,
      headers: { "Content-Type": "application/json", "X-Idempotent-Replay": "1" },
    });
  }

  // Run handler
  const response = await handler();

  // Only cache successful 2xx responses with JSON-ish bodies.
  if (response.status >= 200 && response.status < 300) {
    try {
      const respClone = response.clone();
      const text = await respClone.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text };
      }
      const ttl = Math.max(60, opts.ttlSeconds ?? 24 * 60 * 60);
      await supabase.from("request_idempotency").insert({
        key,
        user_id: opts.userId ?? null,
        request_hash: hash,
        response_json: parsed,
        status_code: response.status,
        expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      });
    } catch {
      // Best-effort caching; never fail the request because of cache write.
    }
  }

  return response;
}
