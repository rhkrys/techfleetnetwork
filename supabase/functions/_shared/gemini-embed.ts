// Shared Gemini embedding contract — the SINGLE place the embedding model lives,
// so the query side (techfleet-chat) and the ingest side (fleety-embed) can
// NEVER drift into different vector spaces again (that mismatch is what silently
// broke retrieval). Pure/testable: no I/O here, just request-shape + parsing.
//
// Model: gemini-embedding-001. `text-embedding-004` was RETIRED by Google
// (returns HTTP 404), which is why retrieval died. gemini-embedding-001 is the
// current embedding model; we pin outputDimensionality=768 to keep the existing
// vector(768) column + HNSW index, and use asymmetric task types (RETRIEVAL_QUERY
// for the question, RETRIEVAL_DOCUMENT for KB rows) — Google optimizes those to
// match, improving retrieval. Cosine ops (vector_cosine_ops) are magnitude-
// invariant, so no normalization step is needed at 768 dims.

export const GEMINI_EMBED_MODEL = "gemini-embedding-001";
export const GEMINI_EMBED_DIM = 768;

/** Stored in knowledge_base.embedding_model. Encodes model + reduced dim so the
 *  backfill re-embeds anything not on THIS exact pipeline (old rows are labeled
 *  differently and get re-done). */
export const GEMINI_EMBED_MODEL_TAG = "gemini-embedding-001-r768";

export type GeminiEmbedTask = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

export function geminiEmbedUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${apiKey}`;
}

export function geminiEmbedBody(text: string, taskType: GeminiEmbedTask) {
  return {
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: GEMINI_EMBED_DIM,
  };
}

/** Extract the 768-float vector from a Gemini embedContent response, or null if
 *  the shape/length is wrong (caller then falls back / logs). */
export function parseGeminiEmbedding(json: unknown): number[] | null {
  const v = (json as { embedding?: { values?: unknown } })?.embedding?.values;
  return Array.isArray(v) && v.length === GEMINI_EMBED_DIM ? (v as number[]) : null;
}
