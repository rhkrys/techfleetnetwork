// @edge-cron
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * Gumroad backfill — fetches the caller's historical sales from the
 * Gumroad API and upserts them into gumroad_sales, then applies the
 * latest tier to the caller's profile.
 *
 * Why this exists:
 *   - The webhook only fires going forward. Sales made before the
 *     webhook was wired up (or ones the webhook missed) need to be
 *     pulled in retroactively.
 *
 * Auth: requires a valid Bearer JWT. We use the caller's verified
 * auth.email() — never a client-supplied email — to filter sales
 * returned by Gumroad's API to only the ones that belong to them.
 *
 * Gumroad API: GET https://api.gumroad.com/v2/sales
 *   - Requires an access token with the `view_sales` scope.
 *   - Paginated via `page_key` (cursor) — we walk all pages.
 *   - Filtered server-side by `email` to minimize payload + privacy
 *     exposure across other buyers.
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
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GUMROAD_ACCESS_TOKEN = Deno.env.get("GUMROAD_ACCESS_TOKEN") ?? "";
const GUMROAD_SELLER_ID = Deno.env.get("GUMROAD_SELLER_ID") ?? "";

type Tier = "starter" | "community" | "professional";

interface GumroadSale {
  id: string;
  email: string;
  seller_id?: string;
  product_id?: string;
  product_permalink?: string;
  permalink?: string;
  price?: number;
  recurrence?: string;
  refunded?: boolean;
  disputed?: boolean;
  // Gumroad sends many more fields; we keep them in raw_payload.
  [key: string]: unknown;
}

interface GumroadSalesResponse {
  success: boolean;
  sales?: GumroadSale[];
  next_page_key?: string;
  next_page_url?: string;
  message?: string;
}

function mapToTier(
  sale: GumroadSale,
): { tier: Tier; isFoundingMember: boolean } {
  const slug = String(
    sale.permalink || sale.product_permalink || "",
  ).toLowerCase();
  if (slug.includes("founding")) {
    return { tier: "community", isFoundingMember: true };
  }
  if (slug.includes("professional")) {
    return { tier: "professional", isFoundingMember: false };
  }
  return { tier: "community", isFoundingMember: false };
}

function normalizeBillingPeriod(sale: GumroadSale, isFoundingMember: boolean): "monthly" | "yearly" {
  const haystack = `${sale.recurrence ?? ""} ${sale.permalink ?? ""} ${sale.product_permalink ?? ""}`.toLowerCase();
  return isFoundingMember || haystack.includes("year") || haystack.includes("annual")
    ? "yearly"
    : "monthly";
}

async function logMembershipMetadataMismatch(
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> },
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
  if (
    details.storedTier === details.expectedTier &&
    details.storedBillingPeriod === details.expectedBillingPeriod &&
    details.storedFoundingMember === details.expectedFoundingMember
  ) return;

  try {
    await admin.rpc("write_audit_log", {
      p_event_type: "membership_metadata_mismatch",
      p_table_name: "profiles",
      p_record_id: details.userId,
      p_user_id: details.userId,
      p_changed_fields: [
        "source:gumroad-backfill",
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
    console.warn("gumroad-backfill: audit log mismatch write failed", err);
  }
}

Deno.serve(withAuditWrapper("gumroad-backfill", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!GUMROAD_ACCESS_TOKEN) {
    console.error("gumroad-backfill: GUMROAD_ACCESS_TOKEN not configured");
    return new Response(
      JSON.stringify({ error: "Backfill not configured" }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(
    token,
  );
  if (claimsErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = claims.claims.sub as string;
  const email = (claims.claims.email as string | undefined)?.toLowerCase();

  if (!email) {
    return new Response(
      JSON.stringify({ ok: true, imported: 0, reason: "no_email" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Walk all pages of the caller's sales.
  const sales: GumroadSale[] = [];
  let pageKey: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 20; // hard cap — 20 pages × ~10/page = 200 sales

  try {
    do {
      const params = new URLSearchParams({
        access_token: GUMROAD_ACCESS_TOKEN,
        email,
      });
      if (pageKey) params.set("page_key", pageKey);

      const resp = await fetch(
        `https://api.gumroad.com/v2/sales?${params.toString()}`,
        { method: "GET" },
      );

      if (!resp.ok) {
        const text = await resp.text();
        console.error("gumroad-backfill: api error", resp.status, text);
        return new Response(
          JSON.stringify({ error: "Gumroad API error", status: resp.status }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const json = (await resp.json()) as GumroadSalesResponse;
      if (!json.success) {
        console.error("gumroad-backfill: unsuccessful response", json.message);
        return new Response(
          JSON.stringify({ error: json.message ?? "Gumroad API error" }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (json.sales?.length) sales.push(...json.sales);
      pageKey = json.next_page_key;
      pageCount += 1;
    } while (pageKey && pageCount < MAX_PAGES);
  } catch (err) {
    console.error("gumroad-backfill: fetch failed", err);
    return new Response(JSON.stringify({ error: "Fetch failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Filter to this seller (defense in depth) and skip refunds/disputes.
  const eligible = sales.filter((s) => {
    if (GUMROAD_SELLER_ID && s.seller_id && s.seller_id !== GUMROAD_SELLER_ID) {
      return false;
    }
    if (s.refunded || s.disputed) return false;
    // Gumroad returns email exactly; double-check case-insensitively.
    if (typeof s.email !== "string") return false;
    return s.email.trim().toLowerCase() === email;
  });

  if (eligible.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, imported: 0, applied: 0 }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Upsert each sale; status 'applied' since we know the user.
  const nowIso = new Date().toISOString();
  const rows = eligible.map((s) => {
    const mapping = mapToTier(s);
    const priceCents = typeof s.price === "number" ? s.price : 0;
    return {
      sale_id: s.id,
      seller_id: s.seller_id ?? GUMROAD_SELLER_ID,
      product_id: s.product_id ?? "",
      product_permalink: s.permalink || s.product_permalink || "",
      email,
      price_cents: priceCents,
      recurrence: typeof s.recurrence === "string" ? s.recurrence : "",
      resolved_tier: mapping.tier,
      resolved_user_id: userId,
      is_founding_member: mapping.isFoundingMember,
      raw_payload: s as unknown as Record<string, unknown>,
      status: "applied",
      received_at: nowIso,
      processed_at: nowIso,
    };
  });

  const { error: upsertErr } = await admin
    .from("gumroad_sales")
    .upsert(rows, { onConflict: "sale_id" });

  if (upsertErr) {
    console.error("gumroad-backfill: upsert failed", upsertErr);
    return new Response(JSON.stringify({ error: "Persist failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pick the "best" tier — professional > community(founding) > community > starter
  const tierRank: Record<Tier, number> = {
    starter: 0,
    community: 1,
    professional: 2,
  };
  let best = rows[0];
  for (const r of rows) {
    const cur = tierRank[r.resolved_tier as Tier];
    const prev = tierRank[best.resolved_tier as Tier];
    if (cur > prev) best = r;
    else if (cur === prev && r.is_founding_member && !best.is_founding_member) {
      best = r;
    }
  }

  const expectedBillingPeriod = normalizeBillingPeriod(
    best.raw_payload as unknown as GumroadSale,
    best.is_founding_member,
  );
  const { data: currentProfile } = await admin
    .from("profiles")
    .select("membership_tier, membership_billing_period, is_founding_member")
    .eq("user_id", userId)
    .maybeSingle();

  await logMembershipMetadataMismatch(admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }, {
    userId,
    saleId: best.sale_id,
    storedTier: currentProfile?.membership_tier,
    expectedTier: best.resolved_tier as Tier,
    storedBillingPeriod: currentProfile?.membership_billing_period,
    expectedBillingPeriod,
    storedFoundingMember: currentProfile?.is_founding_member,
    expectedFoundingMember: best.is_founding_member,
  });

  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      membership_tier: best.resolved_tier,
      is_founding_member: best.is_founding_member,
      membership_billing_period: expectedBillingPeriod,
      membership_sku: best.product_permalink,
      membership_gumroad_sale_id: best.sale_id,
      membership_updated_at: nowIso,
    })
    .eq("user_id", userId);

  if (profileErr) {
    console.error("gumroad-backfill: profile update failed", profileErr);
    return new Response(JSON.stringify({ error: "Profile update failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      imported: rows.length,
      applied: rows.length,
      tier: best.resolved_tier,
      founding: best.is_founding_member,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}));
