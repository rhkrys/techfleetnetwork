// @edge-cron
// Admin-only edge function: streams a CSV file from the private
// `framework-source-csv` bucket and returns its text body. Replaces
// client-side fetch('/data/*.csv') so the framework source-of-record is
// no longer shipped in the public bundle.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9._-]+\.csv$/, "filename must be a plain *.csv name"),
});

serve(
  withAuditWrapper("framework-csv-fetch", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate JWT + admin role
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { filename } = parsed.data;

    // Download via service role (bucket is private)
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: file, error: dlErr } = await admin.storage
      .from("framework-source-csv")
      .download(filename);
    if (dlErr || !file) {
      return new Response(JSON.stringify({ error: "not_found", detail: dlErr?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const csvText = await file.text();
    // SHA-256 checksum for the caller to log into reference_data_sources
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csvText));
    const checksum = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return new Response(
      JSON.stringify({ filename, csv_text: csvText, checksum, bytes: csvText.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  })
);
