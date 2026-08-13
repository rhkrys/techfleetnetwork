// Unit tests for supabase/functions/handoff-download (signed, ownership-checked delivery).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseDownloadBody, SIGNED_URL_TTL_SECONDS } from "./download.ts";

Deno.test("signed-URL TTL is short-lived", () => {
  assert(SIGNED_URL_TTL_SECONDS > 0 && SIGNED_URL_TTL_SECONDS <= 300);
});

Deno.test("parseDownloadBody accepts a uuid, rejects anything else", () => {
  assertEquals(
    parseDownloadBody({ output_file_id: "11111111-1111-1111-1111-111111111111" }).ok,
    true
  );
  assertEquals(parseDownloadBody({ output_file_id: "not-a-uuid" }).ok, false);
  assertEquals(parseDownloadBody({}).ok, false);
  assertEquals(parseDownloadBody(null).ok, false);
});
