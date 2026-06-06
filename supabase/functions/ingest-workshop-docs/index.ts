// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { createEdgeLogger } from "../_shared/logger.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("ingest-workshop-docs");

const BodySchema = z.object({ docs: z.array(z.any()).optional() }).passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Hard caps to prevent oversize uploads from bloating KB */
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 80_000; // ~20k tokens worth of detailed workshop content
const MAX_DOCS_PER_REQUEST = 25;

type WorkshopDoc = {
  title: string;
  /** Pre-parsed markdown body (may already include H1 title — we normalize) */
  content: string;
  /** Optional Figma URL surfaced into the entry */
  figma_url?: string;
  /** Optional preview image URL */
  preview_image_url?: string;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 120);
}

/**
 * Strip dangerous content from admin-supplied markdown before persisting.
 * Admins are trusted, but defense-in-depth: prevent anything that would
 * look like a prompt-injection vector when re-embedded into Fleety's
 * system prompt later.
 */
function sanitizeMarkdown(md: string): string {
  return md
    .replace(/<script[\s>][^]*?<\/script>/gi, "")
    .replace(/<iframe[\s>][^]*?<\/iframe>/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    // Strip attempts to fake a new system message
    .replace(/\<\|im_start\|/gi, "")
    .replace(/\<\|im_end\|/gi, "")
    .replace(/\[SYSTEM\]/gi, "[system]")
    .trim();
}

/**
 * Normalize a workshop into the canonical knowledge_base entry shape so
 * Fleety can pattern-match consistently across uploads.
 */
function buildEntry(doc: WorkshopDoc): { url: string; title: string; content: string } {
  const cleanTitle = doc.title.trim().substring(0, MAX_TITLE_LENGTH);
  const slug = slugify(cleanTitle);
  const url = `workshop://${slug}`;

  let body = sanitizeMarkdown(doc.content);
  if (body.length > MAX_CONTENT_LENGTH) {
    body = body.substring(0, MAX_CONTENT_LENGTH) + "\n\n_[Content truncated for storage]_";
  }

  // Ensure there's an H1 with the title at the top so Fleety always sees it
  if (!/^#\s/m.test(body.split("\n").slice(0, 3).join("\n"))) {
    body = `# ${cleanTitle}\n\n${body}`;
  }

  // Optionally surface Figma + preview as standardized footer fields
  const extras: string[] = [];
  if (doc.preview_image_url && /^https?:\/\//.test(doc.preview_image_url)) {
    extras.push(`![Workshop Preview](${doc.preview_image_url})`);
  }
  if (doc.figma_url && /^https?:\/\//.test(doc.figma_url)) {
    extras.push(`\n## Figma Template\n\n[Open in Figma](${doc.figma_url})`);
  }
  if (extras.length > 0) {
    body += `\n\n${extras.join("\n")}`;
  }

  return {
    url,
    title: `Workshop: ${cleanTitle}`,
    content: body,
  };
}

serve(withAuditWrapper("ingest-workshop-docs", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
    });
  }

  const requestId = crypto.randomUUID().substring(0, 8);

  // ── Admin-only auth ─────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: roleData } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleData) {
    log.warn("auth", `Non-admin upload attempt [${requestId}]: ${userData.user.id}`, { requestId });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Validation ──────────────────────────────────────────────────────
  let body: { docs?: WorkshopDoc[] };
  try {
    const _raw = await req.json();
    const _parsed = BodySchema.safeParse(_raw);
    if (!_parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    body = _parsed.data as { docs?: WorkshopDoc[] };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const docs = body.docs;
  if (!Array.isArray(docs) || docs.length === 0) {
    return new Response(JSON.stringify({ error: "docs must be a non-empty array" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (docs.length > MAX_DOCS_PER_REQUEST) {
    return new Response(
      JSON.stringify({ error: `Maximum ${MAX_DOCS_PER_REQUEST} documents per request` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  for (const d of docs) {
    if (!d || typeof d.title !== "string" || typeof d.content !== "string") {
      return new Response(JSON.stringify({ error: "Each doc requires string title and content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!d.title.trim() || !d.content.trim()) {
      return new Response(JSON.stringify({ error: "Title and content cannot be empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  log.info("ingest", `Ingesting ${docs.length} workshop docs [${requestId}]`, {
    requestId,
    userId: userData.user.id,
    docCount: docs.length,
  });

  let inserted = 0;
  let errors = 0;
  const results: { title: string; url: string; ok: boolean; error?: string }[] = [];

  for (const doc of docs) {
    const entry = buildEntry(doc);
    const { error } = await adminClient.from("knowledge_base").upsert(
      {
        url: entry.url,
        title: entry.title,
        content: entry.content,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "url" },
    );
    if (error) {
      errors++;
      results.push({ title: entry.title, url: entry.url, ok: false, error: error.message });
      log.error("upsert", `Failed [${requestId}]: ${entry.title}`, { requestId }, error);
    } else {
      inserted++;
      results.push({ title: entry.title, url: entry.url, ok: true });
    }
  }

  log.info("ingest", `Done [${requestId}]: ${inserted} inserted, ${errors} errors`, {
    requestId,
    inserted,
    errors,
  });

  return new Response(
    JSON.stringify({ success: true, inserted, errors, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}));
