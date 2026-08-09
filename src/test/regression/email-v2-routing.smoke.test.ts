// Regression coverage for the "dead legacy queue" email-delivery incident
// (2026-08-09). promote-to-teacher and resend-signup-confirmations enqueued via
// the legacy `enqueue_email` RPC — a raw `pgmq.send` into the `transactional_emails`
// / `auth_emails` queues, whose consumer (process-email-queue) was RETIRED at the
// July email-v2 cutover. So every teacher-promotion and safety-net signup email
// was silently stranded in a queue with no reader and never delivered.
//
// Proof of the root cause (live pgmq.metrics_all at time of fix): the
// transactional_emails queue held 7 messages, oldest ~45 days, total_messages ==
// queue_length (i.e. NOTHING was ever consumed); auth_emails held 3.
//
// Fix: route both functions through the live v2 pipeline
// (enqueue_email_v2 -> email_outbox -> email-dispatcher-v2 -> Resend). These are
// hermetic file-content invariants (no DB/network) that FAIL on the pre-fix
// source and PASS after — and they block anyone from reintroducing the
// dead-queue call. If one fails, repair the SOURCE, not the test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const promoteTeacher = read("supabase/functions/promote-to-teacher/index.ts");
const resendSignup = read("supabase/functions/resend-signup-confirmations/index.ts");

// The retired legacy call: `.rpc("enqueue_email", …)` — `enqueue_email`
// immediately followed by a closing quote, which deliberately does NOT match the
// v2 `enqueue_email_v2` (that has `_v2` before the quote).
const LEGACY_ENQUEUE = /\.rpc\(\s*["'`]enqueue_email["'`]/;
const V2_ENQUEUE = /\.rpc\(\s*["'`]enqueue_email_v2["'`]/;

describe("Email v2 routing regression (dead-queue incident 2026-08-09)", () => {
  it("EMAIL-V2-ROUTE-001: promote-to-teacher enqueues via the v2 outbox, not the retired legacy queue", () => {
    expect(promoteTeacher).toMatch(V2_ENQUEUE);
    expect(promoteTeacher).not.toMatch(LEGACY_ENQUEUE);
    // transactional lane; message_id threaded so the terminal write-back trigger
    // can reconcile the email_send_log 'pending' row.
    expect(promoteTeacher).toMatch(/p_lane:\s*["'`]transactional["'`]/);
    expect(promoteTeacher).toMatch(/p_message_id:\s*messageId/);
  });

  it("EMAIL-V2-ROUTE-002: promote-to-teacher no longer reports success on a failed enqueue", () => {
    // The pre-fix code wrapped enqueue in try/catch, swallowed the error, and
    // still returned "Confirmation email sent" — which is exactly how a total
    // send failure stayed invisible for weeks. It must now surface the failure.
    expect(promoteTeacher).toMatch(/if\s*\(\s*enqueueErr\s*\)/);
    expect(promoteTeacher).toMatch(/status:\s*["'`]failed["'`]/);
  });

  it("EMAIL-V2-ROUTE-003: resend-signup-confirmations enqueues via the v2 outbox, not the retired legacy queue", () => {
    expect(resendSignup).toMatch(V2_ENQUEUE);
    expect(resendSignup).not.toMatch(LEGACY_ENQUEUE);
    expect(resendSignup).toMatch(/p_lane:\s*["'`]auth["'`]/);
    expect(resendSignup).toMatch(/p_message_id:\s*messageId/);
  });
});
