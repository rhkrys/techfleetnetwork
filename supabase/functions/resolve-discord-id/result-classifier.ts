// Pure classification of a Discord guild username-search result.
//
// Extracted from index.ts so the resolved incident
//   fingerprint 18d6186852440c10628b405e76ea6c466cee8e1c
// is locked in by result-classifier.test.ts. The essence of that fix: a search
// that returns ZERO guild members is EXPECTED UX (the member typed a handle that
// is not in the guild yet), so it is classified `severity:info` and returned as
// HTTP 200 "User not found" — it must never surface as a system error. Doing so
// previously flooded triage discovery with non-actionable noise.
//
// This module is intentionally dependency-free (no Deno/env/fetch) so it can be
// unit-tested as a regression guard for the shipped edge function.

export interface ResolveClassification {
  /** Audit event_type — differs for the found vs not-found case. */
  eventType: string;
  /** Audit tags. Always includes `severity:info` and `result_count:<n>`. */
  tags: string[];
  /** User-facing response message. */
  responseMessage: string;
}

export function classifyResolveResult(
  candidateCount: number,
  cleanUsername: string,
  candidateUsernames: string[] = []
): ResolveClassification {
  if (candidateCount === 0) {
    // Benign: handle not in the guild yet. severity:info → triage skips it.
    return {
      eventType: "discord_username_not_found",
      tags: [`username:${cleanUsername}`, `result_count:0`, `severity:info`],
      responseMessage: "User not found in server",
    };
  }
  return {
    eventType: "discord_username_candidates_returned",
    tags: [
      `username:${cleanUsername}`,
      `result_count:${candidateCount}`,
      `severity:info`,
      ...candidateUsernames.map((u) => `candidate:${u}`),
    ],
    responseMessage: "Select your Discord account to finish linking.",
  };
}
