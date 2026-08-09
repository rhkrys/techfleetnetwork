// @edge-public
// translate-strings: AI translator for arbitrary UI strings.
// Caches per-string translations in i18n_translations using namespace="dom"
// and key = sha256(source).slice(0,32). Returns a {source -> translation} map.
//
// Auth: requires a Bearer token (any signed-in user). Anon JWT is acceptable
// because the underlying table is publicly readable and writes go through the
// service role inside this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@4.3.6";
import { guardTranslationRequest } from "../_shared/translation-guard.ts";

// M-01: Lenient shape guard. Existing field-by-field checks below remain authoritative;
// this only rejects requests whose top-level body is not a JSON object.
const BodySchema = z
  .object({
    locale: z.string().optional(),
    namespace: z.string().optional(),
    strings: z.array(z.unknown()).optional(),
  })
  .passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_STRINGS = 200;
const MAX_LEN = 2000;

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // H15: require a genuine Supabase JWT (anon ok) + per-identity spend cap.
  const gate = await guardTranslationRequest(req, { max: 30, windowMinutes: 1 });
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  let body: { locale?: string; strings?: unknown; namespace?: string };
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    body = parsed.data as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const locale = String(body.locale ?? "").trim();
  if (!locale || !LOCALE_RE.test(locale)) return json({ error: "invalid_locale" }, 400);
  if (locale.toLowerCase() === "en") return json({ locale, map: {}, cached: 0, translated: 0 });

  if (!Array.isArray(body.strings)) return json({ error: "invalid_strings" }, 400);
  const cleaned = Array.from(
    new Set(
      (body.strings as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= MAX_LEN)
    )
  ).slice(0, MAX_STRINGS);
  if (cleaned.length === 0) return json({ locale, map: {}, cached: 0, translated: 0 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Compute content-addressed keys
  const keyOf = new Map<string, string>(); // source -> key
  await Promise.all(
    cleaned.map(async (s) => {
      const h = await sha256Hex(`${locale}::${s}`);
      keyOf.set(s, h.slice(0, 32));
    })
  );

  // Cache lookup
  const keys = Array.from(keyOf.values());
  const { data: cached } = await supabase
    .from("i18n_translations")
    .select("key,value")
    .eq("locale", locale)
    .eq("namespace", "dom")
    .in("key", keys);

  const cachedMap = new Map<string, string>();
  for (const row of cached ?? []) cachedMap.set(row.key, row.value);

  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const s of cleaned) {
    const k = keyOf.get(s)!;
    const hit = cachedMap.get(k);
    if (typeof hit === "string") out[s] = hit;
    else missing.push(s);
  }

  let translatedCount = 0;
  if (missing.length > 0) {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (apiKey) {
      try {
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content:
                  `You are a professional UI string translator. Translate every string in the input JSON array to BCP-47 locale "${locale}". ` +
                  `Preserve placeholders like {{name}}, %s, leading/trailing whitespace, punctuation, capitalization style, ` +
                  `HTML entities, and proper nouns ("Tech Fleet", "Discord", "Google"). ` +
                  `Return ONLY a JSON array of the same length, in the same order, with translated strings.`,
              },
              { role: "user", content: JSON.stringify(missing) },
            ],
          }),
        });
        if (resp.ok) {
          const j = await resp.json();
          const text: string = j?.choices?.[0]?.message?.content?.trim() ?? "";
          const stripped = text.replace(/^```json\s*|\s*```$/g, "");
          let arr: unknown;
          try {
            arr = JSON.parse(stripped);
          } catch {
            arr = null;
          }
          if (Array.isArray(arr) && arr.length === missing.length) {
            const rows: Array<{
              locale: string;
              namespace: string;
              key: string;
              value: string;
              source_hash: string;
              machine_translated: boolean;
            }> = [];
            for (let i = 0; i < missing.length; i++) {
              const src = missing[i];
              const tr = typeof arr[i] === "string" ? (arr[i] as string) : src;
              out[src] = tr;
              rows.push({
                locale,
                namespace: "dom",
                key: keyOf.get(src)!,
                value: tr,
                source_hash: (await sha256Hex(src)).slice(0, 16),
                machine_translated: true,
              });
              translatedCount++;
            }
            if (rows.length > 0) {
              await supabase
                .from("i18n_translations")
                .upsert(rows, { onConflict: "locale,namespace,key" });
            }
          }
        }
      } catch (_e) {
        // Best-effort: return whatever we have; missing keys fall through to source.
      }
    }
    // Fill any still-missing entries with the source so the client never hangs.
    for (const s of missing) {
      if (!(s in out)) out[s] = s;
    }
  }

  return json({
    locale,
    map: out,
    cached: cleaned.length - missing.length,
    translated: translatedCount,
  });
});
