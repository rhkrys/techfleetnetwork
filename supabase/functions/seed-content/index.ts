// @edge-cron
// One-shot bootstrap: reads bundled MD files and upserts policy_versions.
// Auth: service-role key required (admin-only ops).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const POLICIES: Array<{ key: string; file: string; title: string; summary: string }> = [
  {
    key: "terms-and-conditions",
    file: "Terms-and-Conditions.md",
    title: "Terms and Conditions",
    summary: "Terms and conditions for using Tech Fleet Network.",
  },
  {
    key: "terms-of-use",
    file: "Terms-of-Use.md",
    title: "Terms of Use",
    summary: "Acceptable use of the Tech Fleet Network platform.",
  },
  {
    key: "privacy",
    file: "Privacy-Policy.md",
    title: "Privacy Policy",
    summary: "How Tech Fleet collects, uses, and protects your personal data.",
  },
  {
    key: "cookies",
    file: "Cookie-Policy.md",
    title: "Cookie Policy",
    summary: "How Tech Fleet uses cookies and similar technologies.",
  },
  {
    key: "accessibility",
    file: "Accessibility-Policy.md",
    title: "Accessibility Policy",
    summary: "Our commitment to accessible experiences for everyone.",
  },
  {
    key: "code-of-conduct",
    file: "Code-of-Conduct.md",
    title: "Code of Conduct",
    summary: "Community standards for participation in Tech Fleet.",
  },
];

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(
  withAuditWrapper("seed-content", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    // Require service-role key for safety.
    const auth = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!auth || !serviceKey || !auth.includes(serviceKey)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Retire current rows for the keys we own
    const keys = POLICIES.map((p) => p.key);
    await supabase
      .from("policy_versions")
      .update({ is_current: false })
      .in("policy_key", keys)
      .eq("language", "en")
      .eq("is_current", true);

    const results: Array<{
      key: string;
      bytes: number;
      checksum: string;
      ok: boolean;
      error?: string;
    }> = [];
    for (const p of POLICIES) {
      try {
        const body_md = await Deno.readTextFile(new URL(`./policies/${p.file}`, import.meta.url));
        const checksum = await sha256Hex(body_md);
        const { error } = await supabase.from("policy_versions").upsert(
          {
            policy_key: p.key,
            language: "en",
            version: "1.0.0",
            title: p.title,
            summary: p.summary,
            body_md,
            body_html: null,
            checksum,
            is_current: true,
            effective_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
          },
          { onConflict: "policy_key,version,language" }
        );
        if (error) throw error;
        results.push({
          key: p.key,
          bytes: body_md.length,
          checksum: checksum.slice(0, 8),
          ok: true,
        });
      } catch (e) {
        results.push({
          key: p.key,
          bytes: 0,
          checksum: "",
          ok: false,
          error: String((e as Error).message ?? e),
        });
      }
    }

    return new Response(JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
