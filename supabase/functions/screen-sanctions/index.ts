// @edge-cron
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * screen-sanctions — country-level export-control / sanctions screening
 * called from the registration flow (T&C §19 / ToU §17). Records every
 * decision in `sanctions_screenings` for audit. Does not require auth — the
 * user does not yet have an account when they are screened.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";
import {
  corsHeaders,
  json,
  clientIp,
  isEmbargoed,
  SANCTIONS_LIST_VERSION,
} from "../_shared/compliance.ts";

interface Body {
  email?: string;
  country_code?: string;
}

// M-01: Lenient shape guard. Existing country regex + email slice below stay authoritative.
const BodySchema = z
  .object({
    email: z.string().optional(),
    country_code: z.string().optional(),
  })
  .passthrough();

Deno.serve(
  withAuditWrapper("screen-sanctions", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    let body: Body = {};
    try {
      const raw = await req.json();
      const parsed = BodySchema.safeParse(raw);
      if (!parsed.success) return json({ error: "invalid_body" }, 400);
      body = parsed.data as Body;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const country = (body.country_code || "").trim().toUpperCase();
    if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(country))
      return json({ error: "invalid_country" }, 400);
    const email = (body.email || "").trim().toLowerCase().slice(0, 255);

    const denied = isEmbargoed(country);
    const decision = denied ? "deny" : "allow";
    const reason = denied
      ? `Country ${country} is on the U.S./EU/UK export-control or sanctions list as of ${SANCTIONS_LIST_VERSION}.`
      : null;

    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
    });

    // T-F: the export-control screening record is a mandatory tamper-evident
    // audit row. If it fails to persist we must NOT return an allow/deny decision
    // (that would let a sanctioned/allowed screening happen with no record) —
    // fail closed so the caller retries and compliance is never silently bypassed.
    const { error: auditErr } = await client.rpc("record_sanctions_screening", {
      p_email: email || null,
      p_country: country,
      p_decision: decision,
      p_list_version: SANCTIONS_LIST_VERSION,
      p_reason: reason,
      p_ip: clientIp(req),
    });
    if (auditErr) {
      console.error("record_sanctions_screening failed:", auditErr.message);
      return json({ error: "screening_unavailable" }, 503);
    }

    return json({ decision, reason, list_version: SANCTIONS_LIST_VERSION });
  })
);
