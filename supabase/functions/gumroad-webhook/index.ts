// @edge-public
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * Gumroad Ping webhook receiver.
 *
 * Gumroad's "Ping" feature POSTs application/x-www-form-urlencoded bodies
 * (https://help.gumroad.com/article/40-pings) on every successful sale.
 * Refunds, cancellations, and recurring charges are *not* covered here —
 * those need separate "Resource subscriptions" wired to additional events.
 *
 * Defense in depth:
 *   1. Shared secret via ?secret=… on the URL configured in Gumroad settings.
 *      Compared with timing-safe equality.
 *   2. Seller ID match — Gumroad includes seller_id in the payload; we
 *      verify it matches GUMROAD_SELLER_ID so somebody who learns the URL
 *      still can't replay another seller's webhook.
 *   3. Idempotency — every sale_id is recorded once in gumroad_sales.
 *      Repeat pings short-circuit with HTTP 200 (Gumroad keeps retrying
 *      on non-2xx, so we only return non-2xx for *security* failures).
 *
 * Mapping rules:
 *   - product_permalink "founding-membership" → community + is_founding_member=true
 *   - product_permalink containing "community"   → community
 *   - product_permalink containing "professional"→ professional
 *
 * Email match is case-insensitive against profiles.email. If there's no
 * profile yet (signed up after purchase), we still record the sale and the
 * frontend reconciliation hook will reapply on next login.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GUMROAD_PING_SECRET = Deno.env.get("GUMROAD_PING_SECRET") ?? "";
const GUMROAD_SELLER_ID = Deno.env.get("GUMROAD_SELLER_ID") ?? "";

/** Constant-time string comparison to avoid leaking secret via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface ParsedSale {
  sale_id: string;
  seller_id: string;
  product_id: string;
  product_permalink: string;
  permalink: string;
  email: string;
  price_cents: number;
  recurrence: string;
  full: Record<string, string>;
}

function parsePayload(form: URLSearchParams): ParsedSale {
  const get = (k: string) => form.get(k) ?? "";
  // Gumroad sends some fields as e.g. price (in cents) and offer_code etc.
  const priceRaw = get("price");
  const price_cents = priceRaw ? parseInt(priceRaw, 10) || 0 : 0;
  const full: Record<string, string> = {};
  for (const [k, v] of form.entries()) full[k] = v;
  return {
    sale_id: get("sale_id"),
    seller_id: get("seller_id"),
    product_id: get("product_id"),
    product_permalink: get("product_permalink"),
    permalink: get("permalink"),
    email: get("email"),
    price_cents,
    recurrence: get("recurrence"),
    full,
  };
}

type Tier = "starter" | "community" | "professional";

interface TierMapping {
  tier: Tier;
  isFoundingMember: boolean;
}

function normalizeBillingPeriod(recurrence: string, sale: ParsedSale): "monthly" | "yearly" {
  const haystack = `${recurrence} ${sale.permalink} ${sale.product_permalink}`.toLowerCase();
  return haystack.includes("year") || haystack.includes("annual") || haystack.includes("founding")
    ? "yearly"
    : "monthly";
}

function mapToTier(sale: ParsedSale): TierMapping {
  // Gumroad sends both `permalink` (short slug) and `product_permalink` (full URL).
  // Match on either, lowercased, to be resilient.
  const slug =
    (sale.permalink || sale.product_permalink || "").toLowerCase();
  if (slug.includes("founding")) {
    return { tier: "community", isFoundingMember: true };
  }
  if (slug.includes("professional")) {
    return { tier: "professional", isFoundingMember: false };
  }
  // Default any other Gumroad SKU on this seller to community membership.
  return { tier: "community", isFoundingMember: false };
}

async function logMembershipMetadataMismatch(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> },
  details: {
    userId: string;
    saleId: string;
    storedTier?: string | null;
    expectedTier: Tier;
    storedBillingPeriod?: string | null;
    expectedBillingPeriod: "monthly" | "yearly";
    storedFoundingMember?: boolean | null;
    expectedFoundingMember: boolean;
  },
): Promise<void> {
  const hasMismatch =
    details.storedTier !== details.expectedTier ||
    details.storedBillingPeriod !== details.expectedBillingPeriod ||
    details.storedFoundingMember !== details.expectedFoundingMember;

  if (!hasMismatch) return;

  try {
    await supabase.rpc("write_audit_log", {
      p_event_type: "membership_metadata_mismatch",
      p_table_name: "profiles",
      p_record_id: details.userId,
      p_user_id: details.userId,
      p_changed_fields: [
        `source:gumroad-webhook`,
        `sale_id:${details.saleId}`,
        `stored_tier:${details.storedTier ?? "unknown"}`,
        `expected_tier:${details.expectedTier}`,
        `stored_billing_period:${details.storedBillingPeriod ?? "unknown"}`,
        `expected_billing_period:${details.expectedBillingPeriod}`,
        `stored_founding_member:${String(details.storedFoundingMember ?? false)}`,
        `expected_founding_member:${String(details.expectedFoundingMember)}`,
      ],
      p_error_message:
        "Stored membership metadata differed from the latest subscription metadata before sync.",
    });
  } catch (err) {
    console.warn("gumroad-webhook: audit log mismatch write failed", err);
  }
}

Deno.serve(withAuditWrapper("gumroad-webhook", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Shared-secret check
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get("secret") ?? "";
  if (
    !GUMROAD_PING_SECRET ||
    !providedSecret ||
    !safeEqual(providedSecret, GUMROAD_PING_SECRET)
  ) {
    console.warn("gumroad-webhook: secret mismatch", {
      hasConfigured: !!GUMROAD_PING_SECRET,
      hasProvided: !!providedSecret,
    });
    void emitWebhookSignatureFailure({
      reason: providedSecret ? "secret_mismatch" : "secret_missing",
    });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Parse body (Gumroad sends application/x-www-form-urlencoded)
  let sale: ParsedSale;
  try {
    const ct = req.headers.get("content-type") ?? "";
    let form: URLSearchParams;
    if (ct.includes("application/json")) {
      const json = await req.json();
      form = new URLSearchParams();
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === "string") form.append(k, v);
        else form.append(k, JSON.stringify(v));
      }
    } else {
      const body = await req.text();
      form = new URLSearchParams(body);
    }
    sale = parsePayload(form);
  } catch (err) {
    console.error("gumroad-webhook: parse error", err);
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Seller ID check (defense in depth)
  if (
    !GUMROAD_SELLER_ID ||
    !sale.seller_id ||
    !safeEqual(sale.seller_id, GUMROAD_SELLER_ID)
  ) {
    console.warn("gumroad-webhook: seller_id mismatch", {
      received: sale.seller_id,
    });
    void emitWebhookSignatureFailure({ reason: "seller_id_mismatch" });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!sale.sale_id || !sale.email) {
    console.warn("gumroad-webhook: missing required fields", {
      hasSaleId: !!sale.sale_id,
      hasEmail: !!sale.email,
    });
    return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 4. Idempotency — try to insert; if conflict, ack 200 without re-applying
  const mapping = mapToTier(sale);
  const billingPeriod = normalizeBillingPeriod(sale.recurrence, sale);
  const normalizedEmail = sale.email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from("gumroad_sales")
    .select("id, status")
    .eq("sale_id", sale.sale_id)
    .maybeSingle();

  if (existing && existing.status === "applied") {
    console.log("gumroad-webhook: duplicate sale ignored", sale.sale_id);
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5. Resolve user by email (may be null if user hasn't signed up yet)
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, email, membership_tier, membership_billing_period, is_founding_member")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  // 6. Record the sale (upsert on sale_id)
  const salePayload = {
    sale_id: sale.sale_id,
    seller_id: sale.seller_id,
    product_id: sale.product_id,
    product_permalink: sale.permalink || sale.product_permalink,
    email: normalizedEmail,
    price_cents: sale.price_cents,
    recurrence: sale.recurrence,
    resolved_tier: mapping.tier,
    resolved_user_id: profile?.user_id ?? null,
    is_founding_member: mapping.isFoundingMember,
    raw_payload: sale.full,
    status: profile ? "applied" : "pending_user",
    received_at: new Date().toISOString(),
    processed_at: profile ? new Date().toISOString() : null,
  };

  const { error: upsertErr } = await supabase
    .from("gumroad_sales")
    .upsert(salePayload, { onConflict: "sale_id" });

  if (upsertErr) {
    console.error("gumroad-webhook: failed to record sale", upsertErr);
    // Return 500 so Gumroad retries
    return new Response(JSON.stringify({ error: "Persist failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 7. Apply tier to profile if we have a user
  if (profile) {
    await logMembershipMetadataMismatch(supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }, {
      userId: profile.user_id,
      saleId: sale.sale_id,
      storedTier: profile.membership_tier,
      expectedTier: mapping.tier,
      storedBillingPeriod: profile.membership_billing_period,
      expectedBillingPeriod: billingPeriod,
      storedFoundingMember: profile.is_founding_member,
      expectedFoundingMember: mapping.isFoundingMember,
    });

    const { error: profileErr } = await supabase
      .from("profiles")
      .update({
        membership_tier: mapping.tier,
        is_founding_member: mapping.isFoundingMember,
        membership_billing_period: billingPeriod,
        membership_sku: sale.permalink || sale.product_permalink,
        membership_gumroad_sale_id: sale.sale_id,
        membership_updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.user_id);

    if (profileErr) {
      console.error(
        "gumroad-webhook: failed to update profile",
        profileErr,
      );
      await supabase
        .from("gumroad_sales")
        .update({ status: "error", error_message: profileErr.message })
        .eq("sale_id", sale.sale_id);
      return new Response(JSON.stringify({ error: "Profile update failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      applied: !!profile,
      tier: mapping.tier,
      founding: mapping.isFoundingMember,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}));

/**
 * Emit a `malicious_webhook_signature_invalid` audit row whenever the
 * shared-secret or seller-id check fails. Telemetry must never throw.
 */
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
