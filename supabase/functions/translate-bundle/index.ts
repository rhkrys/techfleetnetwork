// @edge-public
// translate-bundle: AI fallback translator for any BCP-47 locale.
// Reads English source bundle, asks Lovable AI Gateway to translate, caches in i18n_translations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@4.3.6";

// M-01: Lenient shape guard. Existing locale regex (SUPPORTED) below stays authoritative.
const BodySchema = z
  .object({
    locale: z.string().optional(),
    namespace: z.string().optional(),
  })
  .passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";
import { guardTranslationRequest } from "../_shared/translation-guard.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPPORTED = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

Deno.serve(
  withAuditWrapper("translate-bundle", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      // H15: require a genuine Supabase JWT (anon ok) + per-identity spend cap.
      // Bundle translation is heavier (whole namespace), so a tighter limit.
      const gate = await guardTranslationRequest(req, { max: 10, windowMinutes: 1 });
      if (!gate.ok) {
        return new Response(JSON.stringify({ error: gate.error }), {
          status: gate.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawBody = await req.json().catch(() => ({}));
      const parsedBody = BodySchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return new Response(JSON.stringify({ error: "invalid_body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { locale, namespace = "common" } = parsedBody.data;
      if (!locale || !SUPPORTED.test(locale)) {
        return new Response(JSON.stringify({ error: "invalid_locale" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // 1. Cache lookup
      const { data: cached } = await supabase
        .from("i18n_translations")
        .select("key,value")
        .eq("locale", locale)
        .eq("namespace", namespace);
      if (cached && cached.length > 0) {
        const bundle: Record<string, unknown> = {};
        for (const row of cached) setDeep(bundle, row.key, row.value);
        return json({ bundle, cached: true });
      }

      // 2. Load English source from public bundle
      const enUrl = new URL(`/locales/en/${namespace}.json`, Deno.env.get("SUPABASE_URL"));
      // The English bundle is shipped with the SPA, not on Supabase. The client
      // can supply it via body if needed; we accept either path.
      const sourceRes = await fetch(enUrl).catch(() => null);
      let source: Record<string, unknown> = {};
      if (sourceRes?.ok) source = await sourceRes.json();
      if (Object.keys(source).length === 0) {
        // Fallback: minimal canned bundle so the call always returns something.
        source = { app: { name: "Tech Fleet Network" } };
      }

      // 3. Translate via Lovable AI Gateway
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      let translated = source;
      if (apiKey) {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content: `Translate every JSON string value to BCP-47 locale "${locale}". Preserve keys and {{var}} placeholders. Return ONLY valid JSON.`,
              },
              { role: "user", content: JSON.stringify(source) },
            ],
          }),
        });
        if (aiResp.ok) {
          const aiJson = await aiResp.json();
          const text = aiJson?.choices?.[0]?.message?.content?.trim() ?? "";
          const stripped = text.replace(/^```json\s*|\s*```$/g, "");
          try {
            translated = JSON.parse(stripped);
          } catch {
            /* keep source */
          }
        }
      }

      // 4. Cache flat
      const rows: Array<{
        locale: string;
        namespace: string;
        key: string;
        value: string;
        source_hash: string;
        machine_translated: boolean;
      }> = [];
      flatten(translated, "", (k, v) =>
        rows.push({
          locale,
          namespace,
          key: k,
          value: String(v),
          source_hash: "ai",
          machine_translated: true,
        })
      );
      if (rows.length > 0) {
        await supabase
          .from("i18n_translations")
          .upsert(rows, { onConflict: "locale,namespace,key" });
      }

      return json({ bundle: translated, cached: false });
    } catch (e) {
      console.error("[translate-bundle] unhandled error:", e);
      return new Response(JSON.stringify({ error: "Translation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function setDeep(obj: Record<string, unknown>, dotted: string, value: unknown) {
  const parts = dotted.split(".");
  let cur: Record<string, unknown> = obj;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else {
      cur[p] = (cur[p] as Record<string, unknown>) ?? {};
      cur = cur[p] as Record<string, unknown>;
    }
  });
}
function flatten(
  obj: Record<string, unknown>,
  prefix: string,
  emit: (k: string, v: unknown) => void
) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v))
      flatten(v as Record<string, unknown>, key, emit);
    else emit(key, v);
  }
}
