import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyResolveResult } from "./result-classifier.ts";

// Regression for known_issue_catalog fingerprint
//   incident:18d6186852440c10628b405e76ea6c466cee8e1c
// "member typed a Discord handle that is not in the guild yet". The resolved
// behavior: a 0-candidate guild search is EXPECTED UX, classified severity:info
// and returned as HTTP 200 "User not found" — NOT a system error (which used to
// flood triage discovery). This test locks that classification in.

Deno.test(
  "incident:18d6186852440c10628b405e76ea6c466cee8e1c — 0 candidates is benign (severity:info, not-found)",
  () => {
    const c = classifyResolveResult(0, "ghost-user");
    assertEquals(c.eventType, "discord_username_not_found");
    assertEquals(c.responseMessage, "User not found in server");
    assertEquals(c.tags.includes("severity:info"), true, "must be info, never error");
    assertEquals(c.tags.includes("result_count:0"), true);
  }
);

Deno.test("candidates found stays severity:info and carries candidate tags", () => {
  const c = classifyResolveResult(2, "morgan", ["morgan", "morgan_alt"]);
  assertEquals(c.eventType, "discord_username_candidates_returned");
  assertEquals(c.responseMessage, "Select your Discord account to finish linking.");
  assertEquals(c.tags.includes("severity:info"), true);
  assertEquals(c.tags.includes("result_count:2"), true);
  assertEquals(c.tags.includes("candidate:morgan"), true);
  assertEquals(c.tags.includes("candidate:morgan_alt"), true);
});
