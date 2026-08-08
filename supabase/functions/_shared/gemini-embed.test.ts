// Unit tests for the shared Gemini embedding contract (query + ingest share it).
// Guards against the two failures that broke retrieval: a retired model name,
// and query/ingest drifting apart. Run in CI's deno-check job.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GEMINI_EMBED_DIM,
  GEMINI_EMBED_MODEL,
  GEMINI_EMBED_MODEL_TAG,
  geminiEmbedBody,
  geminiEmbedUrl,
  parseGeminiEmbedding,
} from "./gemini-embed.ts";

Deno.test("uses the current (non-retired) embedding model", () => {
  assertEquals(GEMINI_EMBED_MODEL, "gemini-embedding-001");
  // The retired model that caused the HTTP 404 must never come back.
  assert(!geminiEmbedUrl("k").includes("text-embedding-004"));
  assert(geminiEmbedUrl("KEY").includes("gemini-embedding-001:embedContent?key=KEY"));
});

Deno.test("query vs document use asymmetric task types + pinned 768 dims", () => {
  const q = geminiEmbedBody("hi", "RETRIEVAL_QUERY");
  const d = geminiEmbedBody("hi", "RETRIEVAL_DOCUMENT");
  assertEquals(q.taskType, "RETRIEVAL_QUERY");
  assertEquals(d.taskType, "RETRIEVAL_DOCUMENT");
  assertEquals(q.model, "models/gemini-embedding-001");
  assertEquals(q.outputDimensionality, 768);
  assertEquals(d.outputDimensionality, GEMINI_EMBED_DIM);
});

Deno.test("parseGeminiEmbedding: accepts a 768-vector, rejects wrong shape/length", () => {
  const good = Array.from({ length: GEMINI_EMBED_DIM }, () => 0.1);
  assertEquals(parseGeminiEmbedding({ embedding: { values: good } }), good);
  assertEquals(parseGeminiEmbedding({ embedding: { values: [1, 2, 3] } }), null);
  assertEquals(parseGeminiEmbedding({}), null);
  assertEquals(parseGeminiEmbedding(null), null);
});

Deno.test("re-embed tag distinguishes the new pipeline from old/mislabeled rows", () => {
  assertEquals(GEMINI_EMBED_MODEL_TAG, "gemini-embedding-001-r768");
  // Encodes model + reduced dim; old rows labeled plain 'gemini-embedding-001'
  // (a different, shorter string) get re-embedded into the matching space.
  assert(GEMINI_EMBED_MODEL_TAG.startsWith(GEMINI_EMBED_MODEL));
  assert(GEMINI_EMBED_MODEL_TAG.length > GEMINI_EMBED_MODEL.length);
});
