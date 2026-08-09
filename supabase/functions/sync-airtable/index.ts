// @edge-auth
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";

import { withAuditWrapper } from "../_shared/audit.ts";
import { decideOwnership } from "./ownership.ts";

// M-01: Lenient shape guard. Existing application_id type check below stays authoritative.
const BodySchema = z
  .object({
    application_id: z.string().optional(),
    title: z.string().optional(),
    about_yourself: z.string().optional(),
    status: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(
  withAuditWrapper("sync-airtable", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // --- Auth ---
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userId = claimsData.claims.sub as string;
      const userEmail = (claimsData.claims.email as string) ?? "";

      // --- Env ---
      const AIRTABLE_PAT = Deno.env.get("AIRTABLE_PAT");
      if (!AIRTABLE_PAT) throw new Error("AIRTABLE_PAT is not configured");

      const AIRTABLE_BASE_ID = Deno.env.get("AIRTABLE_BASE_ID");
      if (!AIRTABLE_BASE_ID) throw new Error("AIRTABLE_BASE_ID is not configured");

      const AIRTABLE_TABLE_NAME_RAW = Deno.env.get("AIRTABLE_TABLE_NAME");
      if (!AIRTABLE_TABLE_NAME_RAW) throw new Error("AIRTABLE_TABLE_NAME is not configured");
      const AIRTABLE_TABLE_NAME =
        AIRTABLE_TABLE_NAME_RAW.trim() === "General Appications"
          ? "General Applications"
          : AIRTABLE_TABLE_NAME_RAW.trim();

      // --- Body ---
      const rawSyncBody = await req.json();
      const parsedSyncBody = BodySchema.safeParse(rawSyncBody);
      if (!parsedSyncBody.success) {
        return new Response(JSON.stringify({ error: "Invalid body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = parsedSyncBody.data as Record<string, any>;
      const { application_id, title, about_yourself, status, created_at, updated_at, email } = body;

      if (!application_id || typeof application_id !== "string") {
        return new Response(JSON.stringify({ error: "Missing application_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // --- Ownership gate (IDOR fix) ---
      // The caller must own the general_applications row they are syncing; otherwise
      // any authenticated user could pass a victim's application_id and overwrite
      // that Airtable record. The `supabase` client is user-scoped (anon key + the
      // caller's JWT), so its SELECT is bound by RLS ("auth.uid() = user_id") — a
      // non-owner sees zero rows. We still assert the row's user_id explicitly so
      // the gate holds even if that RLS policy were ever weakened (defense in depth).
      const { data: appRow, error: appErr } = await supabase
        .from("general_applications")
        .select("id, user_id")
        .eq("id", application_id)
        .maybeSingle();
      if (appErr) {
        // Fail closed: never reach the Airtable write on an ownership-check failure.
        console.error("sync-airtable ownership check failed", { message: appErr.message });
        return new Response(JSON.stringify({ error: "Ownership check failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const gate = decideOwnership({
        callerUserId: userId,
        check: { found: !!appRow, rowUserId: (appRow?.user_id as string | undefined) ?? null },
      });
      if (!gate.ok) {
        return new Response(JSON.stringify({ error: gate.error }), {
          status: gate.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // --- Airtable upsert ---
      // Use Airtable's native upsert support so sync only requires one write request.
      const encodedTable = encodeURIComponent(AIRTABLE_TABLE_NAME);
      const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodedTable}`;

      const fields = {
        application_id,
        user_id: userId,
        // Prefer the server-verified JWT email; fall back to the body only if the
        // token carries none. Body email is caller-controlled and must not be able
        // to overwrite the stamped identity of the (now ownership-verified) record.
        user_email: userEmail || email,
        title: title ?? "General Application",
        about_yourself: about_yourself ?? "",
        status: status ?? "draft",
        created_at: created_at ?? new Date().toISOString(),
        updated_at: updated_at ?? new Date().toISOString(),
      };

      const airtableRes = await fetch(airtableUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn: ["application_id"] },
          records: [{ fields }],
        }),
      });

      if (!airtableRes.ok) {
        const errBody = await airtableRes.text();
        console.error("sync-airtable Airtable upsert failed", {
          status: airtableRes.status,
          baseId: AIRTABLE_BASE_ID,
          tableName: AIRTABLE_TABLE_NAME,
          patLength: AIRTABLE_PAT.length,
          response: errBody,
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: `Airtable upsert failed [${airtableRes.status}]: ${errBody}`,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const result = await airtableRes.json();
      const firstRecord = result.records?.[0];

      return new Response(JSON.stringify({ success: true, airtable_id: firstRecord?.id ?? null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: unknown) {
      console.error("sync-airtable error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
