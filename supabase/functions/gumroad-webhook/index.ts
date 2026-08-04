// @edge-public
/**
 * Gumroad webhook — LEDGER INGESTION ONLY.
 *
 * Records facts into public.gumroad_sales (the source of truth). It NEVER writes
 * a membership tier: a DB trigger runs public.compute_membership() to derive the
 * profile from the ledger + the membership_products catalog. Handles both the
 * sale Ping and Resource-Subscription lifecycle events (refund / dispute /
 * cancellation / subscription_ended), which set lifecycle timestamps so the
 * projector downgrades access automatically.
 *
 * Security (OWASP Cheat Sheets applied):
 *  - Webhook auth: shared secret via ?secret= (constant-time compare) AND
 *    seller_id match. Failures -> 403 + audit, fail-closed.
 *  - Input Validation: zod schema + a hard body-size cap (DoS).
 *  - Business logic / Abuse: idempotent (sale_id unique upsert); refund/dispute/
 *    end set timestamps that DOWNGRADE via the projector -> no refund fraud.
 *  - Least privilege: service-role only; members can never reach the ledger
 *    (RLS denies authenticated writes regardless of this function).
 *  - No secrets logged; errors never leak internals to the caller.
 */
import { withAuditWrapper } from "../_shared/audit.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GUMROAD_PING_SECRET = Deno.env.get("GUMROAD_PING_SECRET") ?? "";
const GUMROAD_SELLER_ID = Deno.env.get("GUMROAD_SELLER_ID") ?? "";

/** 16 KB is comfortably above any Gumroad payload; caps DoS via huge bodies. */
const MAX_BODY_BYTES = 16 * 1024;

/** Constant-time string comparison — no early exit, no timing leak. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Gumroad encodes booleans inconsistently across event types. */
function truthy(v: string | undefined | null): boolean {
  return v === "true" || v === "1" || v === "yes";
}

/** Neutralize LIKE/ILIKE wildcards (`%` `_` `\`) so an email with those legal
 *  characters can't widen the match to other users' rows (IDOR). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Validate the fields we consume; `.passthrough()` keeps the rest for raw_payload.
const PayloadSchema = z
  .object({
    sale_id: z.string().max(255).optional(),
    seller_id: z.string().max(255).optional(),
    subscription_id: z.string().max(255).optional(),
    product_id: z.string().max(255).optional(),
    product_permalink: z.string().max(1024).optional(),
    permalink: z.string().max(255).optional(),
    email: z.string().max(320).optional(),
    price: z.string().max(32).optional(),
    recurrence: z.string().max(64).optional(),
    refunded: z.string().max(16).optional(),
    disputed: z.string().max(16).optional(),
    dispute_won: z.string().max(16).optional(),
    cancelled: z.string().max(16).optional(),
    ended: z.string().max(16).optional(),
    resource_name: z.string().max(64).optional(),
  })
  .passthrough();

async function readBody(req: Request): Promise<Record<string, string>> {
  // Read the raw body first and enforce the cap on ACTUAL bytes read — the
  // Content-Length header can be omitted or lie (chunked transfer).
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("too_large");
  const ct = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (ct.includes("application/json")) {
    const j = JSON.parse(raw);
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  } else {
    const form = new URLSearchParams(raw);
    for (const [k, v] of form.entries()) out[k] = v;
  }
  return out;
}

Deno.serve(
  withAuditWrapper("gumroad-webhook", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // DoS guard — reject oversized bodies before reading them.
    const declaredLen = parseInt(req.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    // 1. Shared-secret (constant-time). Fail closed + audit.
    const providedSecret = new URL(req.url).searchParams.get("secret") ?? "";
    if (
      !GUMROAD_PING_SECRET ||
      !providedSecret ||
      !safeEqual(providedSecret, GUMROAD_PING_SECRET)
    ) {
      void emitWebhookSignatureFailure({
        reason: providedSecret ? "secret_mismatch" : "secret_missing",
      });
      return json({ error: "Forbidden" }, 403);
    }

    // 2. Parse + validate.
    let raw: Record<string, string>;
    try {
      raw = await readBody(req);
    } catch (e) {
      if ((e as Error).message === "too_large") return json({ error: "Payload too large" }, 413);
      return json({ error: "Bad request" }, 400);
    }
    const parsedResult = PayloadSchema.safeParse(raw);
    if (!parsedResult.success) return json({ error: "Invalid payload" }, 400);
    const p = parsedResult.data;

    // 3. Seller-id (constant-time). Fail closed + audit.
    if (!GUMROAD_SELLER_ID || !p.seller_id || !safeEqual(p.seller_id, GUMROAD_SELLER_ID)) {
      void emitWebhookSignatureFailure({ reason: "seller_id_mismatch" });
      return json({ error: "Forbidden" }, 403);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date().toISOString();

    const isRefund = truthy(p.refunded) || p.resource_name === "refund";
    const isDispute =
      (truthy(p.disputed) && !truthy(p.dispute_won)) || p.resource_name === "dispute";
    const isCancelled = truthy(p.cancelled) || p.resource_name === "cancellation";
    const isEnded = truthy(p.ended) || p.resource_name === "subscription_ended";
    const isLifecycle = isRefund || isDispute || isCancelled || isEnded;

    // 4a. Lifecycle event: patch timestamps on the existing ledger row(s). We do
    // NOT upsert here — that would clobber the sale's resolution. Match by sale_id
    // when present, else by subscription_id. The projector trigger downgrades.
    if (isLifecycle) {
      const patch: Record<string, string> = {};
      if (isRefund) patch.refunded_at = now;
      if (isDispute) patch.disputed_at = now;
      if (isCancelled) patch.subscription_cancelled_at = now;
      if (isEnded) patch.subscription_ended_at = now;

      let q = supabase.from("gumroad_sales").update(patch);
      if (p.sale_id) q = q.eq("sale_id", p.sale_id);
      else if (p.subscription_id) q = q.eq("subscription_id", p.subscription_id);
      else return json({ error: "Missing sale_id/subscription_id" }, 400);

      const { error } = await q;
      if (error) {
        void emitWebhookPersistFailure("lifecycle", error.message);
        return json({ error: "Persist failed" }, 500); // 500 -> Gumroad retries
      }
      return json({ ok: true, lifecycle: true }, 200);
    }

    // 4b. Sale event: upsert the ledger row. Resolve the buyer by verified email.
    if (!p.sale_id) return json({ error: "Missing sale_id" }, 400);
    const normalizedEmail = (p.email ?? "").trim().toLowerCase();

    // Idempotency fast-path: an already-recorded sale needs no re-work.
    const { data: existing } = await supabase
      .from("gumroad_sales")
      .select("id")
      .eq("sale_id", p.sale_id)
      .maybeSingle();
    if (existing) return json({ ok: true, duplicate: true }, 200);

    let resolvedUserId: string | null = null;
    if (normalizedEmail) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_id")
        .ilike("email", escapeLike(normalizedEmail))
        .maybeSingle();
      resolvedUserId = profile?.user_id ?? null;
    }

    const priceCents = p.price ? parseInt(p.price, 10) || 0 : 0;
    const { error: upsertErr } = await supabase.from("gumroad_sales").upsert(
      {
        sale_id: p.sale_id,
        seller_id: p.seller_id,
        subscription_id: p.subscription_id ?? null,
        product_id: p.product_id ?? "",
        product_permalink: p.permalink || p.product_permalink || "",
        email: normalizedEmail,
        price_cents: priceCents,
        recurrence: p.recurrence ?? "",
        resource_name: p.resource_name ?? "sale",
        resolved_user_id: resolvedUserId,
        status: resolvedUserId ? "applied" : "pending_user",
        raw_payload: raw,
        received_at: now,
        processed_at: resolvedUserId ? now : null,
      },
      { onConflict: "sale_id" }
    );
    if (upsertErr) {
      void emitWebhookPersistFailure("sale", upsertErr.message);
      return json({ error: "Persist failed" }, 500); // 500 -> Gumroad retries
    }

    // No tier write here — the AFTER INSERT trigger runs compute_membership().
    return json({ ok: true, recorded: true, resolved: !!resolvedUserId }, 200);
  })
);

/** Emit a signature-failure audit row. Telemetry must never throw. */
async function emitWebhookSignatureFailure(args: { reason: string }): Promise<void> {
  try {
    const [{ auditEdgeEvent }, { getAdminClient }] = await Promise.all([
      import("../_shared/audit.ts"),
      import("../_shared/admin-client.ts"),
    ]);
    await auditEdgeEvent(getAdminClient(), {
      fn: "gumroad-webhook",
      event: "malicious_webhook_signature_invalid",
      table: "edge_function",
      severity: "warn",
      fields: [`provider:gumroad`, `reason:${args.reason}`.slice(0, 100)],
    });
  } catch {
    /* swallow */
  }
}

/** Emit a persist-failure audit row (a webhook that can't be recorded is a real
 *  outage — Gumroad retries, but we want it visible). Never throws. */
async function emitWebhookPersistFailure(kind: string, msg: string): Promise<void> {
  try {
    const [{ auditEdgeEvent }, { getAdminClient }] = await Promise.all([
      import("../_shared/audit.ts"),
      import("../_shared/admin-client.ts"),
    ]);
    await auditEdgeEvent(getAdminClient(), {
      fn: "gumroad-webhook",
      event: "gumroad_sale_persist_failed",
      table: "gumroad_sales",
      severity: "error",
      fields: [`kind:${kind}`],
      errorMessage: msg,
    });
  } catch {
    /* swallow */
  }
}
