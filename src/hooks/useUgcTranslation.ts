/**
 * Translate a single user-generated content field (e.g. project.description).
 *
 * Behavior:
 * 1. If current locale is English (or no locale), returns source text verbatim.
 * 2. Reads from ugc_translations cache (matching entity + column + locale + source_hash).
 * 3. On miss, enqueues a realtime translation job and returns source text immediately
 *    with `isTranslating=true`. A realtime subscription swaps in the translation
 *    when the worker finishes (~2-8 seconds).
 *
 * Source hash is computed client-side via Web Crypto so cache hits are O(1).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface UgcTranslationOpts {
  entityTable: string;
  entityId: string | null | undefined;
  columnName: string;
  sourceText: string | null | undefined;
  contentFormat?: "plain" | "markdown" | "html" | "rich_text";
}

interface UgcTranslationResult {
  text: string;
  isTranslating: boolean;
  isSource: boolean;
}

export function useUgcTranslation({
  entityTable,
  entityId,
  columnName,
  sourceText,
  contentFormat = "plain",
}: UgcTranslationOpts): UgcTranslationResult {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";
  const isEnglish = locale === "en" || locale.startsWith("en-");
  const safeSource = sourceText ?? "";

  const [translated, setTranslated] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    if (!safeSource) { setHash(null); return; }
    sha256Hex(safeSource).then(setHash);
  }, [safeSource]);

  useEffect(() => {
    if (isEnglish || !entityId || !hash || !safeSource) {
      setTranslated(null);
      setIsTranslating(false);
      return;
    }
    let cancelled = false;

    (async () => {
      // 1. Cache lookup
      const { data } = await supabase
        .from("ugc_translations")
        .select("translated_text, status")
        .eq("entity_table", entityTable)
        .eq("entity_id", entityId)
        .eq("column_name", columnName)
        .eq("target_locale", locale)
        .eq("source_hash", hash)
        .in("status", ["qa_passed", "approved"])
        .maybeSingle();
      if (cancelled) return;
      if (data?.translated_text) {
        setTranslated(data.translated_text);
        setIsTranslating(false);
        return;
      }

      // 2. Miss → enqueue
      setIsTranslating(true);
      await supabase.from("ugc_translation_jobs").insert({
        entity_table: entityTable,
        entity_id: entityId,
        column_name: columnName,
        target_locale: locale,
        source_hash: hash,
        source_text: safeSource,
        content_format: contentFormat,
        priority: "realtime",
      });

      // 3. Subscribe for arrival via per-entity Broadcast topic.
      //    This replaces table-level postgres_changes (which leaked every
      //    qa_passed/approved row to all subscribers). The DB trigger
      //    `ugc_translations_broadcast_trg` sends a minimal payload to topic
      //    `ugc:{entityTable}:{entityId}` so each subscriber receives only
      //    translations for the entity they are viewing.
      const channel = supabase
        .channel(`ugc:${entityTable}:${entityId}`)
        .on("broadcast", { event: "ugc_translation" }, (msg: any) => {
          const row = msg?.payload ?? {};
          if (
            row.column_name === columnName &&
            row.target_locale === locale &&
            row.source_hash === hash &&
            typeof row.translated_text === "string"
          ) {
            if (!cancelled) {
              setTranslated(row.translated_text);
              setIsTranslating(false);
            }
            supabase.removeChannel(channel);
          }
        })
        .subscribe();


      // Cleanup on unmount
      return () => { supabase.removeChannel(channel); };
    })();

    return () => { cancelled = true; };
  }, [isEnglish, entityId, columnName, hash, locale, entityTable, safeSource, contentFormat]);

  return useMemo(() => ({
    text: translated ?? safeSource,
    isTranslating,
    isSource: isEnglish || translated === null,
  }), [translated, safeSource, isTranslating, isEnglish]);
}
