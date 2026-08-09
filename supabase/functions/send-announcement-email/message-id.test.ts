// Module: supabase/functions/send-announcement-email (bdd-gate D-13 coverage marker)
// Audit H8 regression — the announcement dedup key must be deterministic.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { announcementMessageId } from "./message-id.ts";

Deno.test("H8: same (announcement, recipient) → identical messageId across runs", () => {
  const a = announcementMessageId("ann-42", "member@example.com");
  const b = announcementMessageId("ann-42", "member@example.com");
  assertEquals(a, b); // a retry re-uses the key → pipeline dedup drops it
});

Deno.test("H8: distinct recipients / announcements → distinct messageIds", () => {
  const base = announcementMessageId("ann-42", "a@example.com");
  assert(base !== announcementMessageId("ann-42", "b@example.com"));
  assert(base !== announcementMessageId("ann-43", "a@example.com"));
});

Deno.test("H8: messageId is not random (no UUID entropy)", () => {
  // Guards against re-introducing crypto.randomUUID() — the original H8 bug.
  const id = announcementMessageId("ann-42", "member@example.com");
  assertEquals(id, "announcement-ann-42-member@example.com");
});
