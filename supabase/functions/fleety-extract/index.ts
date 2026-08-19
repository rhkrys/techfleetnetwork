// @edge-auth required — verify_jwt=true; member-facing. Fleety 2.2-F file uploads.
//
// A member attaches a file (PDF / image / text-or-code) in any of the three Fleety chat
// surfaces. This endpoint turns it into TEXT and returns it; the chat surface then sends that
// text to techfleet-chat as an `attachment`, where it is framed as UNTRUSTED material (the same
// discipline as a shared Figma/URL link). Nothing here is persisted — the bytes live only for
// the duration of this request (ephemeral, no Storage bucket, no retention surface).
//
// Extraction, by true (magic-byte) type:
//   text/code  -> decoded locally as UTF-8 (no LLM, no cost)
//   PDF        -> text layer parsed locally via unpdf (no LLM, no cost)
//   image      -> OCR/description via Gemini Flash vision (DeepSeek can't read pixels); this is
//                 the ONLY external dependency, and it fails gracefully (quota/error -> ask the
//                 member to paste the text) so it can never hard-block a member.
//
// SECURITY: member JWT required; per-user rate limit; size cap (10 MB) enforced from
// Content-Length AND actual bytes; type decided by content not filename; docx/xlsx refused;
// vision prompt frames the image as data-to-transcribe, never instructions.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { extractText, getDocumentProxy } from "npm:unpdf";
import { withAuditWrapper } from "../_shared/audit.ts";
import { enforceEdgeRateLimit } from "../_shared/edge-rate-limit.ts";
import { createEdgeLogger } from "../_shared/logger.ts";
import {
  capText,
  checkUpload,
  type FileCategory,
  MAX_UPLOAD_BYTES,
  safeDisplayName,
  VISION_EXTRACT_PROMPT,
} from "./lib.ts";

const log = createEdgeLogger("fleety-extract");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

const VISION_MODEL = Deno.env.get("FLEETY_VISION_MODEL") || "gemini-2.0-flash";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Parse a PDF's text layer locally (no LLM). Returns "" for a scanned/image-only PDF that
 *  carries no text layer — the caller turns that into member-facing guidance. */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : String(text ?? "")).trim();
}

/** OCR + describe an image via Gemini Flash vision. Throws "vision:<reason>" on a handled
 *  failure (quota, provider error) so the handler can return safe guidance. */
async function extractImageText(
  bytes: Uint8Array,
  mime: "image/png" | "image/jpeg"
): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY") || "";
  if (!key) throw new Error("vision:not-configured");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: VISION_EXTRACT_PROMPT },
              { inlineData: { mimeType: mime, data: encodeBase64(bytes) } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
      }),
    });
    if (res.status === 429) throw new Error("vision:quota");
    if (!res.ok) throw new Error("vision:provider");
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
          .map((p: { text?: string }) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
          .trim()
      : "";
    return text;
  } finally {
    clearTimeout(timer);
  }
}

serve(
  withAuditWrapper("fleety-extract", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // ── Member auth (JWT) ──
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // ── Per-user rate limit (extraction is more expensive than a chat turn) ──
    const rl = await enforceEdgeRateLimit(req, {
      action: "fleety-extract",
      max: 20,
      windowMinutes: 10,
      identifier: `user:${user.id}`,
    });
    if (!rl.allowed) {
      return json(
        { error: "You've uploaded a lot recently — give it a few minutes and try again." },
        429
      );
    }

    // ── Reject oversized bodies before buffering them ──
    const declaredLen = Number(req.headers.get("content-length") || "0");
    if (declaredLen && declaredLen > MAX_UPLOAD_BYTES + 4096) {
      return json({ error: "That file is over the 10 MB limit for Fleety uploads." }, 413);
    }

    // ── Read the multipart file ──
    let file: File | null = null;
    try {
      const form = await req.formData();
      const f = form.get("file");
      if (f instanceof File) file = f;
    } catch {
      return json({ error: "Expected a multipart file upload." }, 400);
    }
    if (!file) return json({ error: "No file was provided." }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkUpload(bytes);
    if (!check.ok) return json({ error: check.error }, 415);

    const displayName = safeDisplayName(file.name);
    const category: FileCategory = check.category;

    try {
      let rawText = "";
      let note = "";

      if (check.route === "text") {
        rawText = new TextDecoder("utf-8").decode(bytes);
      } else if (check.route === "pdf") {
        rawText = await extractPdfText(bytes);
        if (!rawText) {
          // No text layer => scanned/image-only PDF. Don't silently return nothing.
          return json(
            {
              ok: true,
              filename: displayName,
              category,
              chars: 0,
              truncated: false,
              text: "",
              note:
                "This PDF has no readable text layer (it looks scanned). Upload it as an image " +
                "instead, or paste the key text and I'll work from that.",
            },
            200
          );
        }
      } else {
        // vision (png/jpeg)
        try {
          rawText = await extractImageText(bytes, category === "png" ? "image/png" : "image/jpeg");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          const why = /^vision:quota/.test(msg)
            ? "I'm over my image-reading quota for now"
            : /^vision:not-configured/.test(msg)
              ? "image reading isn't enabled yet"
              : "I couldn't read that image";
          return json(
            {
              ok: true,
              filename: displayName,
              category,
              chars: 0,
              truncated: false,
              text: "",
              note: `${why} — paste the text from the image (or describe it) and I'll help.`,
            },
            200
          );
        }
        if (!rawText) {
          return json(
            {
              ok: true,
              filename: displayName,
              category,
              chars: 0,
              truncated: false,
              text: "",
              note: "I couldn't find any readable text in that image — paste or describe it and I'll help.",
            },
            200
          );
        }
      }

      const { text, truncated } = capText(rawText);
      if (truncated)
        note =
          "The file was long, so I read the first part of it. Ask about a specific section for more.";

      log.info("extract", `ok category=${category} chars=${text.length} [user ${user.id}]`);
      return json({
        ok: true,
        filename: displayName,
        category,
        chars: text.length,
        truncated,
        text,
        note,
      });
    } catch (e) {
      // PDF parser errors (corrupt/encrypted) and anything unexpected -> generic, no internals.
      log.error("extract", `failed category=${category}: ${e instanceof Error ? e.message : "?"}`);
      return json(
        {
          error:
            "I couldn't read that file. If it's password-protected or corrupted, try re-exporting it, or paste the text.",
        },
        422
      );
    }
  })
);
