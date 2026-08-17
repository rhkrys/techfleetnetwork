// @edge-auth required — verify_jwt=true; member-facing. Fleety's "review my work against the
// SPF" coach. A member submits a deliverable they've produced (Figma/doc link or pasted text)
// tied to an SPF target; Fleety fetches + extracts it, compares to the SPF expectations, and
// returns advice (strengths, gaps, next steps). SECURITY: SSRF allow-list on the fetch (lib.ts),
// untrusted-material framing in the prompt, bounded size/time, member auth. DeepSeek via
// OpenRouter with the US-provider residency pin (same as techfleet-chat).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withAuditWrapper } from "../_shared/audit.ts";
import { US_INFERENCE_PROVIDERS } from "../_shared/llm/port.ts";
import {
  buildSpfKbRow,
  groupSteps,
  type SpfRow,
  type WorkshopStep,
} from "../fleety-embed/spf-kb.ts";
import {
  assertReviewUrlAllowed,
  buildReviewPrompt,
  capMaterial,
  validateReviewInput,
} from "./lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REVIEW_MODEL = Deno.env.get("FLEETY_LLM_MODEL") || "deepseek/deepseek-v4-pro";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_BYTES = 2_000_000; // 2 MB cap on fetched material (DoS)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** SSRF-guarded, bounded, no-redirect fetch of a member material URL → text. */
async function fetchMaterial(url: string): Promise<string> {
  assertReviewUrlAllowed(url); // throws on violation
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`fetch failed (HTTP ${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const bounded = buf.slice(0, MAX_FETCH_BYTES);
    // Strip tags to plain text (defense against markup; the model reviews content, not HTML).
    return new TextDecoder().decode(bounded).replace(/<[^>]+>/g, " ");
  } finally {
    clearTimeout(timer);
  }
}

/** Assemble the SPF expectations text for a target by reusing the spf-kb content builder. */
// deno-lint-ignore no-explicit-any
async function loadExpectations(
  admin: SupabaseClient<any, any, any>,
  targetType: string,
  slug: string
): Promise<{ name: string; expectations: string } | null> {
  const { data: rows } = await admin
    .from("spf_entity")
    .select("entity_type,slug,name,description,data")
    .eq("entity_type", targetType)
    .eq("slug", slug)
    .eq("is_active", true)
    .limit(1);
  const row = (rows ?? [])[0] as SpfRow | undefined;
  if (!row) return null;

  // For a workshop, fold in its ordered steps (same as the KB embedding does).
  let steps: Map<string, WorkshopStep[]> | undefined;
  if (targetType === "workshop") {
    const { data: stepRows } = await admin
      .from("spf_entity")
      .select("entity_type,slug,name,description,data")
      .eq("entity_type", "workshop_step")
      .eq("is_active", true);
    steps = groupSteps((stepRows ?? []) as SpfRow[]);
  }
  const kb = buildSpfKbRow(row, steps);
  return { name: row.name, expectations: kb?.content ?? row.description ?? "" };
}

/**
 * Minimal output hardening (this is Fleety's own text; strip any stray active markup).
 * Tag-specific regexes are bypassable (nested `<scr<script>ipt>` survives a single pass;
 * `</script bar>` end-tags dodge a fixed close matcher), so we remove ALL angle-bracket tags
 * and repeat until the string stops changing — the CodeQL-documented remedy for
 * incomplete-multi-character sanitization. The client still renders this as text.
 */
function sanitize(text: string): string {
  let out = text;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  }
  return out.replace(/javascript\s*:/gi, "");
}

serve(
  withAuditWrapper("fleety-review", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Member auth (JWT).
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const raw = await req.json().catch(() => null);
    const v = validateReviewInput(raw);
    if (!v.ok) return json({ error: v.error }, 400);
    const { material, target } = v.input;

    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // SPF expectations for the target.
      const exp = await loadExpectations(admin, target.type, target.slug);
      if (!exp) {
        return json({ error: `No SPF ${target.type} found for slug "${target.slug}".` }, 404);
      }

      // Member material (bounded).
      let materialText = "";
      if (material.type === "text") {
        materialText = capMaterial(material.value);
      } else {
        materialText = capMaterial(await fetchMaterial(material.value));
      }

      const { system, user: userMsg } = buildReviewPrompt({
        targetType: target.type,
        targetName: exp.name,
        expectations: exp.expectations,
        material: materialText,
      });

      const apiKey = Deno.env.get("LLM_API_KEY");
      if (!apiKey) return json({ error: "Review service is not configured" }, 500);

      const resp = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: REVIEW_MODEL,
          temperature: 0,
          seed: 1,
          max_tokens: 1400,
          ...(REVIEW_MODEL.includes("deepseek")
            ? { provider: { only: US_INFERENCE_PROVIDERS, allow_fallbacks: true } }
            : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
        }),
      });
      if (!resp.ok) {
        return json({ error: "Review service temporarily unavailable" }, 502);
      }
      const data = await resp.json();
      const review = sanitize(String(data?.choices?.[0]?.message?.content ?? "").trim());
      if (!review) return json({ error: "Review service returned no content" }, 502);

      return json({
        ok: true,
        target: { type: target.type, slug: target.slug, name: exp.name },
        review,
      });
    } catch (e) {
      // SSRF/validation errors surface as 400; everything else generic (no internals leaked).
      const msg = e instanceof Error ? e.message : "Review failed";
      const status = /^SSRF:/.test(msg) ? 400 : 500;
      console.error("fleety-review error");
      return json({ error: status === 400 ? msg : "Review failed" }, status);
    }
  })
);
